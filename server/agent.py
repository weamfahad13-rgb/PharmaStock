import csv
import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "pharmastock-dashboard" / "data"
LOG_FILE = Path(__file__).resolve().parent / "agent_logs.jsonl"
load_dotenv(ROOT / ".env")

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
MAX_ITERATIONS = 5
MAX_TOOL_CALLS = 8
SIM_MONTHS = 3

MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
             "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
POLICY_AR = {
    "System": "النظام (احتياطي مضبوط)", "Seasonal mean": "المتوسط الموسمي (الطريقة الحالية)",
    "Seasonal + safety": "موسمي + احتياطي", "Forecast + safety": "توقع + احتياطي ثابت",
    "Fixed order": "طلب ثابت", "Last month": "تكرار الشهر الماضي",
}
ALIASES = {
    "M01AB": ["ديكلوفيناك", "diclofenac", "فولتارين", "voltaren"],
    "M01AE": ["إيبوبروفين", "ايبوبروفين", "ibuprofen", "بروفين", "brufen"],
    "N02BA": ["أسبرين", "اسبرين", "aspirin"],
    "N02BE": ["باراسيتامول", "paracetamol", "بنادول", "panadol", "acetaminophen"],
    "N05B": ["مضادات القلق", "القلق", "anxiolytics"],
    "N05C": ["المنومات", "منوم", "المهدئات", "مهدئات", "hypnotics", "sedatives"],
    "R03": ["الربو", "ربو", "الجهاز التنفسي", "asthma", "respiratory"],
    "R06": ["الحساسية", "حساسية", "مضادات الهيستامين", "antihistamines", "allergy"],
}

def normalize(text) -> str:
    t = str(text or "").strip().lower()
    t = re.sub(r"[ً-ْ]", "", t)
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي")):
        t = t.replace(a, b)
    return t

class Data:
    def __init__(self, data_dir: Path = DATA_DIR):
        self.raw = json.loads((data_dir / "data.json").read_text(encoding="utf-8"))
        self.meta = self.raw["meta"]
        self.shift = int(self.meta.get("display_year_shift", 0))
        self.cats = {c["code"]: c for c in self.raw["categories"]}
        self.sales_path = data_dir / "sales.csv"
        self._db = None

    def month_name(self, ym: str) -> str:
        return f"{MONTHS_AR[int(ym[5:7]) - 1]} {int(ym[:4]) + self.shift}"

    def get(self, code: str) -> dict:
        q = normalize(code)
        matches = []
        for k, c in self.cats.items():
            names = [normalize(x) for x in [k, c["name_ar"], c["name_en"], *ALIASES.get(k, [])]]
            if q in names:
                return c
            if any(len(n) >= 3 and (q in n or n in q) for n in names):
                matches.append(k)
        if len(matches) == 1:
            return self.cats[matches[0]]
        opts = matches or list(self.cats)
        raise ValueError("الدواء غير واضح. الخيارات: " + "، ".join(f'{self.cats[k]["name_ar"]} ({k})' for k in opts))

    @property
    def db(self) -> sqlite3.Connection:
        if self._db is None:
            db = sqlite3.connect(":memory:", check_same_thread=False)
            db.execute("CREATE TABLE sales (month TEXT, year INTEGER, month_num INTEGER, code TEXT, name_ar TEXT, sales REAL, imputed INTEGER)")
            with self.sales_path.open(encoding="utf-8") as f:
                db.executemany("INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?)", [
                    (f'{int(r["year"]) + self.shift}{r["month"][4:]}', int(r["year"]) + self.shift,
                     int(r["month_num"]), r["code"], r["name_ar"], float(r["sales"]), int(r.get("imputed") or 0))
                    for r in csv.DictReader(f)])
            db.commit()
            db.execute("PRAGMA query_only = 1;")
            allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
            db.set_authorizer(lambda action, *_: sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY)
            self._db = db
        return self._db

def get_inventory(code, data: Data) -> dict:
    c = data.get(code)
    return {"code": c["code"], "name": c["name_ar"], "on_hand": int(c["inventory"]), "expiring": int(c["expiring"]),
            "last_sales": c["last_sales"], "status": c["status_label"], "status_meaning": c["status_hint"],
            "days_of_cover": c["cover_days"]}

def forecast(code, data: Data, months=3) -> dict:
    c = data.get(code)
    plan = c["plan"][:max(1, min(int(months), len(c["plan"])))]
    return {"code": c["code"], "name": c["name_ar"], "model": c["model"],
            "months": [data.month_name(p["month"]) for p in plan],
            "values": [p["forecast"] for p in plan],
            "seasonal_pattern_pct": [p["season_pct"] for p in plan],
            "forecast_accuracy_pct": c["perf"]["forecast_accuracy"]}

def calculate_order(code, data: Data) -> dict:
    c = data.get(code)
    this_m, arrive_m = data.month_name(data.meta["next_month"]), data.month_name(data.meta["arrival_month"])
    p0, p1 = c["plan"][0], c["plan"][1]
    return {"code": c["code"], "name": c["name_ar"], "recommended": int(c["recommended_order"]),
            "safety_stock": int(c["safety_added"]), "on_hand": int(c["inventory"]),
            "order_month": this_m, "arrival_month": arrive_m,
            "expected_demand": {this_m: c["forecast_next"], arrive_m: c["forecast_arrival"]},
            "seasonal_pattern_pct": {this_m: p0["season_pct"], arrive_m: p1["season_pct"]},
            "seasonal_pattern_note": "النمط الموسمي: كم يكون هذا الشهر عادةً أعلى أو أقل من متوسط السنة، من كل تاريخ المبيعات.",
            "expiring_end_of_" + this_m: int(c["expiring"]),
            "leftover_after_" + this_m: c.get("leftover_after", round(_leftover(c["inventory"], c["expiring"], c["forecast_next"]))),
            "explanation": c.get("reco_explain", ""),
            "expiring_note": f"العلب التي تنتهي صلاحيتها تُصرف أولاً في {this_m}، وما لم يُصرف منها لا يُحسب ضمن المتبقي.",
            "reason": f"(يخص شهر {this_m}) {c['reason']}",
            "how_calculated": f"الكمية = طلب {arrive_m} + الاحتياطي − المتبقي من المخزون بعد {this_m}. "
                              f"عجز {this_m} (إن وجد) لا يُضاف إلى الكمية."}

def _leftover(on_hand, expiring, fc0):
    return max(0.0, on_hand - max(fc0, expiring))

def _simulate(c, data: Data, first_order: float) -> dict:
    shelf = int(data.meta["shelf_life_months"])
    costs = data.meta["costs"]
    plan = c["plan"]
    batches = [[float(c["expiring"]), shelf - 1], [float(c["inventory"] - c["expiring"]), 0]]
    batches = [b for b in batches if b[0] > 0]
    lost = expired = demand_total = cost = 0.0
    for k in range(SIM_MONTHS):
        on_hand = sum(q for q, _ in batches)
        fc0, fc1 = plan[k]["forecast"], plan[k + 1]["forecast"]
        expiring = sum(q_ for q_, a in batches if a == shelf - 1)
        q = first_order if k == 0 else max(0.0, fc1 + c["safety_added"] - _leftover(on_hand, expiring, fc0))
        need = fc0
        batches.sort(key=lambda b: -b[1])
        for b in batches:
            take = min(b[0], need); b[0] -= take; need -= take
        for b in batches:
            b[1] += 1
        exp = sum(q_ for q_, a in batches if a >= shelf)
        batches = [b for b in batches if b[1] < shelf and b[0] > 1e-9]
        left = sum(q_ for q_, _ in batches)
        cost += costs["holding"] * left + costs["stockout"] * need + costs["expired"] * exp
        lost += need; expired += exp; demand_total += fc0
        if q > 0:
            batches.append([q, 0])
    return {"lost_units": round(lost), "expired": round(expired),
            "fill_rate": round((1 - lost / demand_total) * 100, 1) if demand_total else 100.0, "cost": round(cost)}

def simulate_order(code, qty, data: Data) -> dict:
    c = data.get(code)
    qty = float(qty)
    if qty < 0:
        raise ValueError("الكمية لا يمكن أن تكون سالبة.")
    mine, system = _simulate(c, data, qty), _simulate(c, data, c["recommended_order"])
    verdict = ("غير كافية: نفاد متوقع" if mine["lost_units"] > system["lost_units"] else
               "زائدة: تلف متوقع" if mine["expired"] > system["expired"] else
               "مناسبة" if mine["cost"] <= system["cost"] * 1.02 else "أعلى تكلفة من توصية النظام")
    return {"code": c["code"], "name": c["name_ar"], "qty": int(qty), "horizon_months": SIM_MONTHS,
            **mine, "system_recommendation": {"qty": int(c["recommended_order"]), **system}, "verdict": verdict,
            "note": f"سيناريو متوقع على {SIM_MONTHS} أشهر: يفترض أن المخزون الحالي مطابق لآخر تصدير من النظام. الطلب = التوقع، وبعد الطلب الأول يكمل النظام بقاعدته المعتادة.",
            "cost_note": "التكلفة نقاط للمقارنة فقط وليست مبلغاً مالياً: لكل علبة ناقصة 4، ولكل علبة تالفة 3، ولكل علبة مخزّنة شهراً 1."}

def _peak_month(c):
    return max(c["plan"], key=lambda p: p["season_pct"])

def compare_drugs(code_a, code_b, data: Data) -> dict:
    a, b = data.get(code_a), data.get(code_b)
    def card(c):
        pk = _peak_month(c)
        return {"code": c["code"], "name": c["name_ar"], "on_hand": int(c["inventory"]), "status": c["status_label"],
                "days_of_cover": c["cover_days"], "forecast_next": c["forecast_next"],
                "recommended": int(c["recommended_order"]), "fill_rate_pct": c["perf"]["fill_rate"],
                "forecast_accuracy_pct": c["perf"]["forecast_accuracy"],
                "upcoming_peak": f'{data.month_name(pk["month"])} ({pk["season_pct"]:+.0f}%)'}
    A, B = card(a), card(b)
    diff = []
    for key, label in (("forecast_next", "الطلب المتوقع"), ("on_hand", "المخزون"), ("recommended", "الكمية الموصى بها")):
        if A[key] and B[key]:
            hi, lo = (A, B) if A[key] >= B[key] else (B, A)
            diff.append(f'{label}: {hi["name"]} أعلى من {lo["name"]} بـ {round((hi[key] / lo[key] - 1) * 100)}%')
    if A["days_of_cover"] != B["days_of_cover"]:
        low = A if A["days_of_cover"] < B["days_of_cover"] else B
        diff.append(f'{low["name"]} أقرب للنفاد ({low["days_of_cover"]} يوم)')
    return {"a": A, "b": B, "differences": diff}

def list_critical_drugs(data: Data) -> dict:
    critical = [{"code": c["code"], "name": c["name_ar"], "status": c["status_label"], "order": int(c["recommended_order"]),
                 "days_of_cover": c["cover_days"]}
                for c in data.raw["categories"] if c["status"] in ("out", "urgent", "order")]
    return {"drugs": critical, "count": len(critical),
            "note": "الحرجة: نفدت، أو تنفد هذا الأسبوع، أو لا تكفي الشهر." if critical else "لا توجد أدوية حرجة الآن."}

def _consecutive(months):
    left, periods = set(months), []
    while left:
        start = next(m for m in sorted(left) if (m - 2) % 12 + 1 not in left) if any(
            (m - 2) % 12 + 1 not in left for m in left) else min(left)
        p, m = [], start
        while m in left:
            p.append(m); left.discard(m); m = m % 12 + 1
        periods.append(p)
    return periods

def explain_seasonality(code, data: Data) -> dict:
    c = data.get(code)
    overall = sum(c["history"]["sales"]) / len(c["history"]["sales"])
    profile = {m: round((v - 1) * 100, 1) for m, v in enumerate(c["seasonal_index"], 1)}
    peaks = sorted([m for m, p in profile.items() if p >= 15], key=lambda m: -profile[m])
    lows = sorted([m for m, p in profile.items() if p <= -15], key=lambda m: profile[m])
    fmt = lambda ms: "، ".join(f"{MONTHS_AR[m - 1]} ({profile[m]:+.0f}%)" for m in ms)
    periods = _consecutive(peaks)
    period_text = [" و".join(MONTHS_AR[m - 1] for m in p) for p in periods]
    explanation = (f"متوسط مبيعات {c['name_ar']} {round(overall)} علبة شهرياً. "
                   + (f"أعلى الأشهر: {fmt(peaks)}. " if peaks else "لا توجد ذروة واضحة. ")
                   + (f"عدد فترات الذروة {len(periods)} منفصلة: " + "، ".join(
                       f"ذروة {i}: {t}" for i, t in enumerate(period_text, 1)) + ". " if len(periods) > 1 else "")
                   + (f"أدنى الأشهر: {fmt(lows)}." if lows else "لا يوجد ركود واضح."))
    return {"code": c["code"], "name": c["name_ar"], "peak_months": [MONTHS_AR[m - 1] for m in peaks],
            "peak_periods": period_text,
            "low_months": [MONTHS_AR[m - 1] for m in lows], "average_monthly_sales": round(overall),
            "monthly_vs_average_pct": {MONTHS_AR[m - 1]: p for m, p in profile.items()}, "explanation": explanation,
            "note": "الأرقام من البيانات التاريخية؛ البيانات لا تتضمن أسباب الموسم."}

def compare_policies(code, data: Data) -> dict:
    c = data.get(code)
    rows = c.get("policies")
    scope = c["name_ar"]
    if not rows:
        rows = data.raw["benchmark"]["policies"]
        scope = "كل الأدوية (المقارنة لكل دواء غير موجودة في هذا التصدير)"
    pol = [{"policy": POLICY_AR.get(r["policy"], r["policy"]), "cost": round(r["total_cost"]),
            "lost_units": round(r["lost_units"]), "expired_units": round(r["expired_units"]),
            "fill_rate_pct": round(r.get("fill_rate_%", r.get("fill_rate", 0)), 1)} for r in rows]
    pol.sort(key=lambda r: r["cost"])
    cost = {r["policy"]: r["total_cost"] for r in rows}
    saving = round((1 - cost["System"] / cost["Seasonal mean"]) * 100, 1) if "System" in cost and "Seasonal mean" in cost else None
    return {"scope": scope, "test_months": data.meta["test_months"], "policies": pol, "best": pol[0]["policy"],
            "saving_pct": saving, "note": "التكلفة = تخزين + نفاد + تلف، على أشهر اختبار لم يرها النظام."}

SQL_FORBIDDEN = re.compile(r"\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum)\b", re.I)

def query_sales(sql, data: Data) -> dict:
    q = str(sql or "").strip().rstrip(";").strip()
    if ";" in q or not re.match(r"^(select|with)\b", q, re.I) or SQL_FORBIDDEN.search(q):
        raise ValueError("مسموح فقط باستعلام قراءة واحد (SELECT).")
    try:
        cur = data.db.execute(q)
    except sqlite3.Error as e:
        raise ValueError(f"خطأ في الاستعلام: {e}")
    cols = [d[0] for d in cur.description]
    rows = [[round(v, 1) if isinstance(v, float) else v for v in r] for r in cur.fetchmany(200)]
    return {"columns": cols, "rows": rows, "row_count": len(rows)}

def call_tool(name: str, args: dict, data: Data) -> dict:
    try:
        if name == "get_inventory":        return get_inventory(args["code"], data)
        if name == "forecast":             return forecast(args["code"], data, args.get("months", 3))
        if name == "calculate_order":      return calculate_order(args["code"], data)
        if name == "simulate_order":       return simulate_order(args["code"], args["qty"], data)
        if name == "compare_drugs":        return compare_drugs(args["code_a"], args["code_b"], data)
        if name == "list_critical_drugs":  return list_critical_drugs(data)
        if name == "explain_seasonality":  return explain_seasonality(args["code"], data)
        if name == "compare_policies":     return compare_policies(args["code"], data)
        if name == "query_sales":          return query_sales(args["sql"], data)
        return {"error": f"أداة غير معروفة: {name}"}
    except KeyError as e:
        return {"error": f"مدخل ناقص للأداة {name}: {e}"}
    except Exception as e:
        return {"error": str(e)}

CODE = {"type": "string", "description": "كود الدواء (مثل N02BE) أو اسمه كما كتبه الصيدلي"}
TOOLS_SCHEMAS = [
    {"name": "get_inventory", "description": "المخزون الحالي لدواء، والعلب التي تنتهي صلاحيتها هذا الشهر، وآخر مبيعات، والحالة، وكم يوماً يكفي.",
     "parameters": {"type": "object", "properties": {"code": CODE}, "required": ["code"]}},
    {"name": "forecast", "description": "توقع الطلب لدواء في الأشهر القادمة (حتى 6)، مع النمط الموسمي لكل شهر (مقارنة بمتوسط السنة).",
     "parameters": {"type": "object", "properties": {"code": CODE, "months": {"type": "integer", "description": "عدد الأشهر (1-6)، الافتراضي 3"}},
                    "required": ["code"]}},
    {"name": "calculate_order", "description": "الكمية الموصى بطلبها الآن لدواء، والاحتياطي، وشهر الوصول، وسبب التوصية.",
     "parameters": {"type": "object", "properties": {"code": CODE}, "required": ["code"]}},
    {"name": "simulate_order", "description": "يحاكي سيناريو طلب كمية معينة ويرجع الأثر (نفاد، تلف، نسبة تلبية الطلب، تكلفة) مقارنة بتوصية النظام. استخدمه لأسئلة 'لو طلبنا X'.",
     "parameters": {"type": "object", "properties": {"code": CODE, "qty": {"type": "integer", "description": "الكمية المطلوبة"}},
                    "required": ["code", "qty"]}},
    {"name": "compare_drugs", "description": "مقارنة دوائين: المخزون، والطلب المتوقع، والتوصية، والأداء، والذروة القادمة، مع أهم الفروق.",
     "parameters": {"type": "object", "properties": {"code_a": CODE, "code_b": CODE}, "required": ["code_a", "code_b"]}},
    {"name": "list_critical_drugs", "description": "الأدوية التي تحتاج طلباً عاجلاً (نفدت، أو تنفد هذا الأسبوع، أو لا تكفي الشهر)، مرتبة حسب الأولوية.",
     "parameters": {"type": "object", "properties": {}}},
    {"name": "explain_seasonality", "description": "يشرح لماذا يرتفع أو ينخفض طلب دواء في أشهر معينة، من كل تاريخ المبيعات: أشهر الذروة والركود ونسبتها.",
     "parameters": {"type": "object", "properties": {"code": CODE}, "required": ["code"]}},
    {"name": "compare_policies", "description": "مقارنة سياسات الطلب لدواء (النظام مقابل الطرق التقليدية) على أشهر اختبار حقيقية: التكلفة والنفاد والتلف، وأفضل سياسة، ونسبة التوفير.",
     "parameters": {"type": "object", "properties": {"code": CODE}, "required": ["code"]}},
    {"name": "query_sales", "description": "استعلام SQLite للقراءة فقط على المبيعات الشهرية التاريخية، لأي سؤال تحليلي لا تغطيه الأدوات الأخرى (أعلى شهر، مجاميع سنوية، مقارنات بين سنوات). "
                                          "الجدول: sales(month TEXT 'YYYY-MM', year INTEGER, month_num INTEGER 1-12, code TEXT, name_ar TEXT, sales REAL, imputed INTEGER: 1 = شهر بياناته معطوبة وعُوِّض بالاستيفاء، اذكر ذلك إن ظهر في النتيجة). استعلام SELECT واحد فقط.",
     "parameters": {"type": "object", "properties": {"sql": {"type": "string", "description": "استعلام SELECT واحد"}}, "required": ["sql"]}},
]
DECLARATIONS = [types.FunctionDeclaration(name=t["name"], description=t["description"], parameters_json_schema=t["parameters"])
                for t in TOOLS_SCHEMAS]

def system_prompt(data: Data) -> str:
    m = data.meta
    codes = "، ".join(f'{c["code"]} = {c["name_ar"]}' for c in data.raw["categories"])
    return f"""أنت مساعد صيدلي ذكي لإدارة المخزون. عندك أدوات تستدعيها للحصول على بيانات دقيقة.

قواعد:
1. لا تخمّن أي رقم — استخدم الأدوات دائماً.
2. لو السؤال يحتاج معلومة من أكثر من مصدر، استدعِ أكثر من أداة.
3. لو السؤال "لو/ماذا لو" (what-if)، استخدم simulate_order.
4. لو السؤال عن دواء غير واضح، اسأل المستخدم.
5. اجعل الجواب مختصراً بالعربي، مع أرقام واضحة.
6. لو أداة رجعت خطأ، اعتذر واقترح بديلاً.
7. لا تعطِ نصائح طبية (جرعات، بدائل علاجية، تفاعلات) — أنت مساعد مخزون، والقرار الطبي للصيدلي.
8. أنت لا تعتمد الطلبات؛ الاعتماد يتم من صفحة الدواء في الداشبورد.
9. صياغة محايدة دائماً: لا تخاطب المستخدم بصيغة مذكر أو مؤنث. استخدم مثلاً "يُنصح بطلب…"، "الكمية المقترحة…"، "يمكن…"، بدلاً من "اطلب/اطلبي" أو "انتظر/انتظري".
10. لا تذكر اسم النموذج أو الشركة المزوّدة؛ قدّم نفسك كمساعد مخزون PharmaStock.
11. عند شرح الموسمية: اذكر الأشهر والنسب فقط، ولا تخترع أسباباً (شتاء، حساسية، عطل) لم ترد في نتيجة الأداة. واعتمد على peak_periods: لا تصف ذروتين منفصلتين كأنها ذروة واحدة مستمرة.
12. لا تذكر للمستخدم تاريخاً أو شهراً لوصول الطلب؛ مدة التوريد افتراض داخلي في الحساب فقط.
13. عند مقارنة النظام بالطرق الأخرى: النظام هو الأقل تكلفة في مجموع الأدوية، لكنه ليس الأفضل لكل دواء بالضرورة. انقل نتيجة compare_policies كما هي، حتى لو كانت طريقة أخرى أفضل لهذا الدواء.

معلومات النظام:
- الفئات الثمانية ورموزها: {codes}.
- شهر الطلب الحالي: {data.month_name(m["next_month"])}. الحساب يفترض أن الطلب يُستلم في {data.month_name(m["arrival_month"])} (لا تذكر ذلك للمستخدم).
- الحساب يفترض صلاحية متبقية عند الاستلام {"شهر واحد" if m["shelf_life_months"] == 1 else "شهرين" if m["shelf_life_months"] == 2 else str(m["shelf_life_months"]) + " أشهر"}، والعلب الأقدم تُصرف أولاً.
- المبيعات التاريخية من {data.month_name(m["first_month"])} إلى {data.month_name(m["current_month"])}؛ أول وآخر سنة غير مكتملتين، وشهر معطوب واحد عُوِّض بالاستيفاء (imputed = 1) — انتبه عند مقارنة مجاميع السنوات.
"""

DATA: Data | None = None

def get_data() -> Data:
    global DATA
    if DATA is None:
        DATA = Data()
    return DATA

def _client():
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("NO_KEY")
    return genai.Client(api_key=key)

def _log(entry: dict):
    entry = {"ts": datetime.now().isoformat(timespec="seconds"), **entry}
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        print(json.dumps(entry, ensure_ascii=False), flush=True)

def run_agent(user_message: str, history: list[dict], data: Data | None = None, client=None) -> dict:
    data = data or get_data()
    client = client or _client()
    contents = [types.Content(role=h["role"], parts=[types.Part(text=h["text"])])
                for h in history[-10:] if h.get("role") in ("user", "model") and h.get("text")]
    contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))
    config = types.GenerateContentConfig(
        system_instruction=system_prompt(data),
        tools=[types.Tool(function_declarations=DECLARATIONS)],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        temperature=0.2,
    )
    tool_trace = []
    for i in range(MAX_ITERATIONS):
        response = client.models.generate_content(model=MODEL, contents=contents, config=config)
        calls = response.function_calls or []
        if not calls:
            answer = (response.text or "").strip()
            _log({"question": user_message, "answer": answer, "iterations": i + 1, "tool_calls": len(tool_trace)})
            return {"answer": answer, "tool_trace": tool_trace, "iterations": i + 1}
        contents.append(response.candidates[0].content)
        parts = []
        for fc in calls:
            args = dict(fc.args or {})
            if len(tool_trace) >= MAX_TOOL_CALLS:
                result = {"error": f"تجاوزت الحد الأقصى ({MAX_TOOL_CALLS}) لاستدعاء الأدوات. أجب بما لديك."}
            else:
                result = call_tool(fc.name, args, data)
                tool_trace.append({"tool": fc.name, "args": args, "result": result})
                _log({"question": user_message, "iteration": i + 1, "tool": fc.name, "args": args, "result": result})
            parts.append(types.Part.from_function_response(name=fc.name, response=result))
        contents.append(types.Content(role="user", parts=parts))
    answer = "تعذّر إكمال الطلب. جرّب تقسيم السؤال لأسئلة أبسط."
    _log({"question": user_message, "answer": answer, "iterations": MAX_ITERATIONS, "tool_calls": len(tool_trace)})
    return {"answer": answer, "tool_trace": tool_trace, "iterations": MAX_ITERATIONS}
