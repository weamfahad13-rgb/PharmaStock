import sys
import time

import agent

PAUSE = 25

OK, FAIL = "✅", "❌"
results = []

def check(name, cond, detail=""):
    results.append(bool(cond))
    print(f"{OK if cond else FAIL} {name}" + (f" — {detail}" if detail else ""))

def offline():
    print("===== اختبار الأدوات (بدون Gemini) =====")
    d = agent.get_data()
    t = lambda name, **a: agent.call_tool(name, a, d)

    r = t("get_inventory", code="N02BE")
    check("get_inventory بالرمز", "on_hand" in r and r["code"] == "N02BE", f'{r.get("on_hand")} وحدة')
    check("get_inventory بالاسم العربي", t("get_inventory", code="بنادول").get("code") == "N02BE")
    check("اسم غامض يرجع خيارات", "error" in t("get_inventory", code="مسكنات"))
    r = t("forecast", code="R03", months=3)
    check("forecast", len(r["values"]) == 3, str(r["values"]))
    r = t("calculate_order", code="N02BE")
    check("calculate_order", r["recommended"] >= 0 and r["arrival_month"], f'{r["recommended"]} وحدة')
    low, high, rec = t("simulate_order", code="N02BE", qty=200), t("simulate_order", code="N02BE", qty=5000), \
        t("simulate_order", code="N02BE", qty=t("calculate_order", code="N02BE")["recommended"])
    check("simulate_order: كمية قليلة ← نفاد أكثر", low["lost_units"] > rec["lost_units"], f'{low["lost_units"]} مقابل {rec["lost_units"]}')
    check("simulate_order: كمية كبيرة ← تلف أكثر", high["expired"] > rec["expired"], f'{high["expired"]} مقابل {rec["expired"]}')
    check("simulate_order: التوصية = نفسها", rec["cost"] == rec["system_recommendation"]["cost"])
    r = t("compare_drugs", code_a="M01AE", code_b="N02BA")
    check("compare_drugs", r["a"]["code"] == "M01AE" and r["b"]["code"] == "N02BA", f'{len(r["differences"])} فروق')
    r = t("list_critical_drugs")
    check("list_critical_drugs", "drugs" in r, f'{r["count"]} أدوية')
    r = t("explain_seasonality", code="N02BE")
    check("explain_seasonality", "explanation" in r, ", ".join(r["peak_months"]))
    r = t("compare_policies", code="N02BE")
    check("compare_policies", r["best"] and r["policies"], f'الأفضل: {r["best"]} | {r["scope"]}')
    r = t("query_sales", sql="SELECT year, SUM(sales) FROM sales WHERE code='R03' GROUP BY year")
    check("query_sales", r.get("row_count", 0) > 0, f'{r.get("row_count")} صف')
    for bad in ["DELETE FROM sales", "SELECT 1; DROP TABLE sales", "SELECT * FROM pragma_table_info('sales')"]:
        check(f"حماية SQL: {bad[:30]}", "error" in t("query_sales", sql=bad))
    check("البيانات سليمة بعد محاولات الحذف", d.db.execute("SELECT COUNT(*) FROM sales").fetchone()[0] > 0)

QUESTIONS = [
    ("كم باراسيتامول؟", {"get_inventory"}, 1),
    ("أيش أطلب الأسبوع الجاي؟", {"list_critical_drugs", "calculate_order"}, 1),
    ("لو طلبنا 500 باراسيتامول؟", {"simulate_order"}, 1),
    ("قارن إيبوبروفين وأسبرين", {"compare_drugs"}, 1),
    ("ليش الطلب عالي في أكتوبر على الباراسيتامول؟", {"explain_seasonality"}, 1),
    ("أيش الأدوية الحرجة؟", {"list_critical_drugs"}, 1),
    ("أيش أفضل سياسة للباراسيتامول؟", {"compare_policies"}, 1),
    ("جهز تقرير كامل عن الأدوية اللي تحتاج طلب", None, 3),
]

def ask(q):
    for attempt in range(3):
        try:
            return agent.run_agent(q, [])
        except RuntimeError:
            raise
        except Exception as e:
            if "429" not in str(e) or attempt == 2:
                raise
            print("   ⏳ وصلنا لحد Gemini المجاني، ننتظر دقيقة...")
            time.sleep(62)

def online():
    print("\n===== الأسئلة الثمانية مع Gemini =====")
    for i, (q, expected, min_tools) in enumerate(QUESTIONS):
        if i:
            time.sleep(PAUSE)
        try:
            out = ask(q)
        except RuntimeError:
            print(f"{FAIL} لا يوجد مفتاح Gemini في .env"); results.append(False); return
        used = [t["tool"] for t in out["tool_trace"]]
        ok = len(used) >= min_tools and (expected is None or bool(expected & set(used)))
        check(q, ok, f"الأدوات: {used or 'لا شيء'} | جولات: {out['iterations']}")
        print("   ↳", out["answer"][:160].replace("\n", " "))

if __name__ == "__main__":
    offline()
    if "--online" in sys.argv:
        online()
    print(f"\nالنتيجة: {sum(results)} من {len(results)} ناجح")
    sys.exit(0 if all(results) else 1)
