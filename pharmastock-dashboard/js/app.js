(() => {
  const D = window.DASH_DATA;
  const view = document.getElementById("view");

  if (!D || !D.summary || !D.meta.arrival_month) {
    view.innerHTML = `<div class="card">ملف البيانات <b>data/data.js</b> غير موجود أو بصيغة قديمة. شغّل خلية التصدير في Colab وضع الملف الناتج داخل مجلد data.</div>`;
    return;
  }

  const CATS = D.categories;
  const byCode = Object.fromEntries(CATS.map((c) => [c.code, c]));
  const S = D.summary;
  const HAS_CHART = typeof Chart !== "undefined";

  const SHIFT = D.meta.display_year_shift || 0;
  const sh = (ym) => (SHIFT ? `${+ym.slice(0, 4) + SHIFT}${ym.slice(4)}` : ym);
  const NEXT = sh(D.meta.next_month);
  const ARRIVE = sh(D.meta.arrival_month);

  const C = {
    blue100: "#bde3fb", blue300: "#92bcfa", blue500: "#6a9cf2", blue700: "#3d6fd6",
    coral: "#d9644c", peachStrong: "#f6b9a8", ink: "#24324f", muted: "#8a96b3", line: "#e4ecfa",
  };
  if (HAS_CHART) {
    Chart.defaults.font.family = "'IBM Plex Sans Arabic', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = C.muted;
    Chart.defaults.borderColor = C.line;
    Chart.defaults.plugins.legend.rtl = true;
    Chart.defaults.plugins.tooltip.rtl = true;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.maintainAspectRatio = false;
  }

  const ICONS = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    chart: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    up: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    down: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    arrow: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  };
  const icon = (n) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
  document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon)));

  const fmt = (v) => Math.round(v).toLocaleString("en-US");
  const fmt1 = (v) => (Math.round(v * 10) / 10).toLocaleString("en-US");
  const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const monthName = (ym) => `${MONTHS_AR[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  const MODEL_AR = { XGBoost: "XGBoost", Prophet: "Prophet", Average: "متوسط XGBoost و Prophet" };
  const PILL_CLS = { out: "st-out", urgent: "st-urgent", order: "st-order", over: "st-over", ok: "st-ok" };
  const monthsText = (k) => (k === 1 ? "شهر" : k === 2 ? "شهرين" : `${k} أشهر`);
  const coverText = (c) =>
    c.status === "out" ? "نفد" : c.cover_days < 1 ? "أقل من يوم"
      : `${c.cover_days < 10 ? fmt1(c.cover_days) : fmt(c.cover_days)} يوم`;

  const KEY = "pharmastock_orders";
  const loadOrders = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const saveOrders = () => { try { localStorage.setItem(KEY, JSON.stringify(ORDERS)); } catch (e) {} };
  let ORDERS = loadOrders();

  const okey = (code) => `${code}|${D.meta.next_month}|${D.meta.generated}`;
  const approvedOf = (code) => ORDERS[okey(code)];

  const statusPill = (c) =>
    approvedOf(c.code)
      ? `<span class="pill st-approved">تم الاعتماد</span>`
      : `<span class="pill ${PILL_CLS[c.status]}" data-tip="${c.status_hint}">${c.status_label}</span>`;

  const drugCell = (c) =>
    `<div class="drug"><div class="drug-icon">${icon("pill")}</div><div><b>${c.name_ar}</b><span>${c.code} · ${c.name_en}</span></div></div>`;

  let charts = [];
  const clearCharts = () => { charts.forEach((ch) => ch.destroy()); charts = []; };
  const makeChart = (id, cfg) => {
    const el = document.getElementById(id);
    if (HAS_CHART && el) charts.push(new Chart(el, cfg));
  };
  const areaGradient = (ctx, top, bottom) => {
    const { ctx: c, chartArea } = ctx.chart;
    if (!chartArea) return top;
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    return g;
  };
  const hbar = (id, labels, data, colors, tipFmt, xOpts = {}) => makeChart(id, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 8, barThickness: 16 }] },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => tipFmt(x.raw) } } },
      scales: { x: { reverse: true, grid: { color: C.line }, ticks: { callback: (v) => v + "%" }, ...xOpts },
                y: { grid: { display: false }, position: "right" } },
    },
  });

  const pendingCats = () => CATS.filter((c) => c.recommended_order > 0 && !approvedOf(c.code));

  let homeFilter = "all";

  function renderHome() {
    const pending = pendingCats();
    const first = pending[0];
    const n = pending.length;
    const heroTitle = n
      ? `لديك <em>${n === 1 ? "دواء واحد يحتاج" : n === 2 ? "دواءان يحتاجان" : n + " أدوية تحتاج"}</em> طلباً الآن`
      : `كل الطلبات الحالية <em>معتمدة</em> ✓`;
    const K = S.counts;

    view.innerHTML = `
      <div class="hero">
        <div class="hero-text">
          <h2>${heroTitle}</h2>
          <p>توصيات النظام جاهزة للمراجعة والاعتماد.</p>
          <div class="hero-stats">
            <div class="hero-stat"><b class="num">${fmt(S.total_order_units)}</b><span>وحدة مقترحة للطلب</span></div>
            <div class="hero-stat"><b class="num">${K.out}</b><span>نفد مخزونها</span></div>
            <div class="hero-stat"><b class="num">${CATS.length}</b><span>فئة دوائية</span></div>
          </div>
          ${first
            ? `<a class="btn btn-primary" href="#med/${first.code}">مراجعة الطلبات ${icon("arrow")}</a>`
            : `<a class="btn btn-ghost" href="#perf">أداء النظام ${icon("arrow")}</a>`}
        </div>
        <img class="hero-img" src="assets/hero.jpg" alt="صناديق أدوية ومؤشرات المخزون">
      </div>

      <div class="grid g-4">
        ${kpiCard("order", "blue", "box", "تحتاج طلب", S.n_need_order, `من أصل ${CATS.length} فئات`)}
        ${kpiCard("urgent", "coral", "alert", `${D.status_info.out.label} أو ${D.status_info.urgent.label}`, S.n_critical, `${K.out} ${D.status_info.out.label} · ${K.urgent} ${D.status_info.urgent.label}`)}
        ${kpiCard("over", "amber", "layers", D.status_info.over.label, K.over, D.status_info.over.hint)}
        ${kpiCard("all", "mint", "shield", "نسبة تلبية الطلب", fmt1(S.fill_rate) + "%", "على أشهر الاختبار")}
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card-head">
          <div><h3>حالة الأدوية</h3><p>مرتبة من الأكثر حاجة للتدخل</p></div>
          <div class="filters">
            <button class="chip ${homeFilter === "all" ? "active" : ""}" data-filter="all">الكل</button>
            ${Object.entries(D.status_info).map(([k, v]) =>
              `<button class="chip ${homeFilter === k ? "active" : ""}" data-filter="${k}">${v.label}</button>`).join("")}
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>الدواء</th><th>المخزون الحالي</th><th>يكفي لـ</th><th>الطلب المتوقع</th>
              <th>التوصية</th><th>الحالة</th><th></th>
            </tr></thead>
            <tbody>${statusRows()}</tbody>
          </table>
        </div>
      </div>

      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><div><h3>تنبيهات موسمية</h3><p>الأشهر القادمة مقارنة بمتوسط السنة، من كل تاريخ المبيعات</p></div></div>
          <div class="alert-list">${alertsHTML()}</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>توقع الشهرين القادمين</h3><p>التغيّر مقارنة بآخر 3 أشهر</p></div></div>
          <div class="chart-box"><canvas id="outlookChart"></canvas></div>
        </div>
      </div>`;

    view.querySelectorAll("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => { homeFilter = b.dataset.filter; renderHome(); }));
    view.querySelectorAll("[data-kpi]").forEach((b) =>
      b.addEventListener("click", () => { homeFilter = b.dataset.kpi; renderHome(); }));
    view.querySelectorAll("tr[data-code]").forEach((tr) =>
      tr.addEventListener("click", () => (location.hash = `#med/${tr.dataset.code}`)));

    hbar("outlookChart", CATS.map((c) => c.name_ar), CATS.map((c) => c.outlook_change),
      CATS.map((c) => (c.outlook_change >= 0 ? C.blue300 : C.peachStrong)),
      (v) => `${v > 0 ? "+" : ""}${v}%`);
  }

  function kpiCard(filter, color, ic, label, value, sub) {
    return `
      <div class="card kpi ${homeFilter === filter && filter !== "all" ? "selected" : ""}" data-kpi="${filter}">
        <div class="kpi-icon ${color}">${icon(ic)}</div>
        <div><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div><div class="kpi-sub">${sub}</div></div>
      </div>`;
  }

  function statusRows() {
    const rows = CATS.filter((c) => homeFilter === "all" || c.status === homeFilter
      || (homeFilter === "urgent" && c.status === "out"));
    if (!rows.length) return `<tr><td colspan="7" class="muted">لا توجد أدوية في هذه الحالة.</td></tr>`;
    return rows.map((c) => {
      const ap = approvedOf(c.code);
      const reco = ap ? `طلب ${fmt(ap.qty)}` : c.recommended_order > 0 ? `طلب ${fmt(c.recommended_order)}` : "لا حاجة للطلب";
      const bar = Math.min(c.cover_days, 60) / 60 * 100;
      return `
        <tr class="clickable" data-code="${c.code}">
          <td>${drugCell(c)}</td>
          <td class="num">${fmt(c.inventory)}</td>
          <td><div class="cover-bar"><div class="cover-track"><div class="cover-fill" style="width:${bar}%;background:${c.status === "out" || c.status === "urgent" ? C.coral : C.blue300}"></div></div><span class="num">${coverText(c)}</span></div></td>
          <td class="num">${fmt(c.forecast_next)}</td>
          <td><b class="num"${!ap && c.reco_explain ? ` data-tip="${c.reco_explain}"` : ""}>${reco}</b></td>
          <td>${statusPill(c)}</td>
          <td><a class="btn btn-ghost btn-sm" href="#med/${c.code}">عرض</a></td>
        </tr>`;
    }).join("");
  }

  function alertsHTML() {
    if (!D.alerts.length) return `<div class="muted">لا توجد تغيّرات موسمية كبيرة قريباً.</div>`;
    return D.alerts.map((a) =>
      `<a class="alert" href="#med/${a.code}"><div class="alert-icon ${a.type}">${icon(a.type)}</div><div><b>${a.title}</b><span>${a.text}</span></div></a>`
    ).join("");
  }

  let editing = false;

  function renderMed(code) {
    if (!code || !byCode[code]) {
      location.replace(`#med/${CATS[0].code}`);
      return;
    }
    const c = byCode[code];
    const nm = +NEXT.slice(5, 7);

    view.innerHTML = `
      <div class="drug-chips">
        ${CATS.map((x) => `<a class="chip ${x.code === code ? "active" : ""}" href="#med/${x.code}" style="text-decoration:none">${x.name_ar}</a>`).join("")}
      </div>

      <div class="grid g-main">
        <div class="card reco">
          <div class="reco-top">${drugCell(c)}${statusPill(c)}</div>
          <div style="margin-top:18px" class="reco-label">الكمية المقترحة للطلب الآن</div>
          <div class="reco-number num">${fmt(c.recommended_order)} <small>وحدة</small></div>
          <div class="reco-compare">مدة التوريد: ${monthsText(D.meta.lead_time_months)} · الصلاحية عند الاستلام: ${monthsText(D.meta.shelf_life_months)}</div>

          <ul class="why">
            <li><span>الطلب المتوقع في ${MONTHS_AR[+NEXT.slice(5, 7) - 1]} (${MODEL_AR[c.model]})</span><b>${fmt(c.forecast_next)}</b></li>
            <li><span>الطلب المتوقع في ${MONTHS_AR[+ARRIVE.slice(5, 7) - 1]}</span><b>${fmt(c.forecast_arrival)}</b></li>
            <li><span>المخزون الموجود الآن</span><b>${fmt(c.inventory)}</b></li>
            <li><span>منها تنتهي صلاحيتها هذا الشهر</span><b style="color:${c.expiring > 0 ? "var(--coral)" : "inherit"}">${fmt(c.expiring)}</b></li>
            <li><span>احتياطي مضاف فوق التوقع</span><b>${fmt(c.safety_added)}</b></li>
            ${c.leftover_after !== undefined ? `<li><span>يتبقى من المخزون بعد ${MONTHS_AR[+NEXT.slice(5, 7) - 1]}</span><b>${fmt(c.leftover_after)}</b></li>` : ""}
          </ul>
          ${c.reco_explain ? `<div class="why-note"><b>كيف حُسبت الكمية؟</b> ${c.reco_explain}</div>` : ""}
          <div class="why-note">${c.reason}</div>

          <div id="approveArea">${approveHTML(c, approvedOf(code))}</div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>ملخص الوضع</h3><p>${monthName(sh(D.meta.current_month))}</p></div></div>
          <div class="mini-stats">
            <div class="mini"><span>المخزون الحالي</span><b class="num">${fmt(c.inventory)}</b><small>وحدة</small></div>
            <div class="mini"><span>يكفي لمدة</span><b class="num" style="color:${c.status === "out" || c.status === "urgent" ? C.coral : C.ink}">${coverText(c)}</b><small>حسب معدل البيع</small></div>
            <div class="mini"><span>مبيعات الشهر الماضي</span><b class="num">${fmt(c.last_sales)}</b><small>وحدة</small></div>
            <div class="mini"><span>تنتهي صلاحيتها هذا الشهر</span><b class="num" style="color:${c.expiring > 0 ? C.coral : C.ink}">${fmt(c.expiring)}</b><small>علبة</small></div>
            <div class="mini"><span>دقة توقع الطلب</span><b class="num">${fmt1(c.perf.forecast_accuracy)}%</b><small>${MODEL_AR[c.model]}</small></div>          </div>
        </div>
      </div>

      ${c.plan ? `<div class="card" style="margin-bottom:18px">
        <div class="card-head"><div><h3>خطة الأشهر القادمة</h3><p>الكمية تتغيّر كل شهر حسب الموسم والمخزون والصلاحية</p></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>شهر الطلب</th><th>الطلب المتوقع</th><th>المخزون أول الشهر</th><th>الكمية المقترحة</th><th>الموسم</th><th>السبب</th></tr></thead>
          <tbody>${c.plan.map((p, i) => `<tr class="${i === 0 ? "highlight" : ""}">
            <td>${monthName(sh(p.month))}${i === 0 ? ' <span class="pill st-order">الآن</span>' : ""}</td>
            <td class="num">${fmt(p.forecast)}</td>
            <td class="num">${fmt(p.on_hand_start)}</td>
            <td class="num"><b>${fmt(p.order)}</b></td>
            <td class="num" style="color:${p.season_pct >= 20 ? "var(--coral)" : p.season_pct <= -20 ? "var(--blue-700)" : "inherit"}">${p.season_pct > 0 ? "+" : ""}${fmt(p.season_pct)}%</td>
            <td style="white-space:normal;min-width:260px;font-size:13px;color:var(--ink-2)">${p.reason}</td>
          </tr>`).join("")}</tbody>
        </table></div>
      </div>` : ""}

      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><div><h3>المبيعات والتوقعات</h3><p>النموذج المختار لهذا الدواء: ${MODEL_AR[c.model]}</p></div></div>
        <div class="chart-box tall"><canvas id="salesChart"></canvas></div>
      </div>

      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><div><h3>النمط الموسمي</h3><p>1.0 = متوسط السنة، من كل تاريخ المبيعات. العمود الداكن هو الشهر القادم</p></div></div>
          <div class="chart-box"><canvas id="seasonChart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>قرارات النظام السابقة</h3><p>على أشهر لم يرها أثناء التدريب</p></div></div>
          <div class="chart-box"><canvas id="decisionChart"></canvas></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>سجل الطلبات المعتمدة</h3><p>يُحفظ في هذا المتصفح</p></div></div>
        ${orderLogHTML(code)}
      </div>`;

    bindApprove(c);
    drawMedCharts(c);
  }

  function approveHTML(c, ap) {
    if (ap) {
      return `<div class="approved">${icon("check")} تم اعتماد طلب <span class="num">${fmt(ap.qty)}</span> وحدة ${ap.edited ? "(معدّل يدوياً)" : ""}
        <button data-act="undo">إلغاء الاعتماد</button></div>`;
    }
    if (editing) {
      return `<div class="edit-row">
          <input type="number" min="0" step="1" id="qtyInput" value="${Math.round(c.recommended_order)}" aria-label="الكمية">
          <button class="btn btn-primary" data-act="save">${icon("check")} حفظ واعتماد</button>
          <button class="btn btn-ghost" data-act="cancel">إلغاء</button>
        </div>`;
    }
    return `<div class="actions">
        <button class="btn btn-primary" data-act="approve">${icon("check")} اعتماد الطلب</button>
        <button class="btn btn-ghost" data-act="edit">${icon("edit")} تعديل الكمية</button>
      </div>`;
  }

  function bindApprove(c) {
    document.getElementById("approveArea").onclick = (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "approve") setOrder(c, c.recommended_order, false);
      if (act === "edit") { editing = true; rerender(); }
      if (act === "cancel") { editing = false; rerender(); }
      if (act === "save") {
        const v = parseFloat(document.getElementById("qtyInput").value);
        if (isNaN(v) || v < 0) return;
        setOrder(c, v, Math.round(v) !== Math.round(c.recommended_order));
      }
      if (act === "undo") { delete ORDERS[okey(c.code)]; saveOrders(); rerender(); }
    };
  }

  function setOrder(c, qty, edited) {
    ORDERS[okey(c.code)] = { code: c.code, month: D.meta.next_month, qty, edited,
                             suggested: c.recommended_order, at: new Date().toISOString() };
    saveOrders();
    editing = false;
    rerender();
  }

  function orderLogHTML(code) {
    const list = Object.values(ORDERS).filter((o) => o.code === code).sort((a, b) => b.at.localeCompare(a.at));
    if (!list.length) return `<div class="muted">لم يتم اعتماد أي طلب لهذه الفئة بعد.</div>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th>الشهر</th><th>الكمية المعتمدة</th><th>توصية النظام</th><th>النوع</th><th>تاريخ الاعتماد</th></tr></thead>
      <tbody>${list.map((o) => `<tr>
        <td>${monthName(sh(o.month))}</td><td class="num">${fmt(o.qty)}</td><td class="num">${fmt(o.suggested)}</td>
        <td>${o.edited ? '<span class="pill st-over">معدّل</span>' : '<span class="pill st-ok">كما هي</span>'}</td>
        <td class="num">${new Date(o.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  function drawMedCharts(c) {
    const hm = c.history.months.map(sh), hs = c.history.sales;
    const labels = [...hm, ...c.forecast2.months.map(sh)];
    const N = hm.length;
    const testStart = N - c.test.months.length;
    const pad = (arr, start) => labels.map((_, i) => (i >= start && i < start + arr.length ? arr[i - start] : null));

    const nextLine = labels.map((_, i) => (i === N - 1 ? hs[N - 1] : i >= N ? c.forecast2.values[i - N] : null));

    makeChart("salesChart", {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "المبيعات الفعلية", data: pad(hs, 0), borderColor: C.blue500, borderWidth: 2, pointRadius: 0, tension: 0.35, fill: true,
            backgroundColor: (ctx) => areaGradient(ctx, "rgba(146,188,250,.35)", "rgba(146,188,250,0)") },
          { label: `${MODEL_AR[c.model]} (فترة الاختبار)`, data: pad(c.test.fc, testStart), borderColor: C.blue700, borderDash: [5, 4], borderWidth: 2, pointRadius: 2, tension: 0.3 },
          { label: "توقع الشهرين القادمين", data: nextLine, borderColor: C.coral, borderDash: [3, 4], borderWidth: 2, pointRadius: 4, tension: 0.3 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top", align: "start" } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { beginAtZero: true, position: "right" } },
      },
    });

    const nm = +NEXT.slice(5, 7);
    makeChart("seasonChart", {
      type: "bar",
      data: { labels: MONTHS_AR, datasets: [{ label: "المعامل الموسمي", data: c.seasonal_index,
        backgroundColor: c.seasonal_index.map((_, i) => (i === nm - 1 ? C.blue700 : C.blue100)), borderRadius: 8 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } }, y: { suggestedMin: 0.5, position: "right" } },
      },
    });

    const t = c.test;
    makeChart("decisionChart", {
      data: {
        labels: t.months.map(sh),
        datasets: [
          { type: "bar", label: "كمية الطلب", data: t.order, backgroundColor: C.blue100, borderRadius: 6, order: 3 },
          { type: "line", label: "الطلب الفعلي", data: t.demand, borderColor: C.blue700, borderWidth: 2, pointRadius: 2, tension: 0.3, order: 1 },
          { type: "line", label: "المخزون المتبقي", data: t.inv, borderColor: C.peachStrong, borderWidth: 2, borderDash: [4, 4], pointRadius: 0, tension: 0.3, order: 2 },
          { type: "line", label: "نفاد", data: t.demand.map((d, i) => (t.lost[i] > 0 ? d : null)),
            showLine: false, pointRadius: 7, pointBackgroundColor: C.coral, borderColor: C.coral, order: 0 },
          { type: "line", label: "علب تالفة", data: t.expired.map((e, i) => (e > 0 ? t.inv[i] : null)),
            showLine: false, pointRadius: 7, pointStyle: "triangle", pointBackgroundColor: "#b07c14", borderColor: "#b07c14", order: 0 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top", align: "start" } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true, position: "right" } },
      },
    });
  }

  function renderPerf() {
    const months = D.meta.test_months;
    view.innerHTML = `
      <div class="grid g-4">
        ${statCard("mint", "shield", "نسبة تلبية الطلب", fmt1(S.fill_rate) + "%", `من كل 100 علبة طُلبت، توفّرت ${Math.round(S.fill_rate)}`)}
        ${statCard("coral", "alert", "علب لم تتوفر للعملاء", fmt(S.lost_units), `لكل الأدوية خلال ${months} شهراً`)}
        ${statCard("amber", "layers", "علب انتهت صلاحيتها", fmt(S.expired_units), `لكل الأدوية خلال ${months} شهراً`)}
        ${statCard("blue", "up", "دقة توقع الطلب", fmt1(S.forecast_accuracy) + "%", "متوسط كل الأدوية")}
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-head"><div><h3>تلبية الطلب لكل دواء</h3><p>نسبة الطلب الذي توفّر للعملاء</p></div></div>
          <div class="chart-box tall"><canvas id="fillChart"></canvas></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><div><h3>الأداء لكل دواء</h3><p>خلال ${months} شهراً من الاختبار</p></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>الدواء</th><th>تلبية الطلب</th><th>علب لم تتوفر</th><th>علب تالفة</th><th>متوسط المخزون</th><th>دقة التوقع</th><th>نموذج التوقع</th></tr></thead>
          <tbody>${CATS.map((c) => `<tr>
            <td>${drugCell(c)}</td>
            <td class="num" style="color:var(--mint);font-weight:700">${fmt1(c.perf.fill_rate)}%</td>
            <td class="num">${fmt(c.perf.lost)}</td>
            <td class="num">${fmt(c.perf.expired)}</td>
            <td class="num">${fmt1(c.perf.avg_inventory)}</td>
            <td class="num">${fmt1(c.perf.forecast_accuracy)}%</td>
            <td>${MODEL_AR[c.model]}</td>
          </tr>`).join("")}</tbody>
        </table></div>
      </div>`;

    hbar("fillChart", CATS.map((c) => c.name_ar), CATS.map((c) => c.perf.fill_rate),
      CATS.map(() => C.blue300), (v) => `${v}%`, { min: 70, max: 100 });
  }

  function statCard(color, ic, label, value, sub) {
    return `<div class="card kpi" style="cursor:default">
      <div class="kpi-icon ${color}">${icon(ic)}</div>
      <div><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div><div class="kpi-sub">${sub}</div></div>
    </div>`;
  }

  function updateBell() {
    const list = pendingCats();
    const badge = document.getElementById("bellCount");
    badge.hidden = !list.length;
    badge.textContent = list.length;
    document.getElementById("bellPop").innerHTML =
      `<h4>طلبات بانتظار الاعتماد</h4>` +
      (list.length
        ? list.map((c) => `<a class="pop-item" href="#med/${c.code}"><span>${c.name_ar}</span>${statusPill(c)}</a>`).join("")
        : `<div class="pop-empty">لا توجد طلبات معلّقة ✓</div>`);
  }

  const tip = document.createElement("div");
  tip.className = "tip";
  document.body.appendChild(tip);
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    tip.textContent = el.dataset.tip;
    const r = el.getBoundingClientRect();

    const half = Math.min(tip.offsetWidth, window.innerWidth - 16) / 2;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${r.top - 8}px`;
    tip.classList.add("show");
  });
  document.addEventListener("mouseout", (e) => { if (e.target.closest("[data-tip]")) tip.classList.remove("show"); });
  window.addEventListener("scroll", () => tip.classList.remove("show"), { passive: true });
  window.addEventListener("hashchange", () => tip.classList.remove("show"));

  const bellBtn = document.getElementById("bellBtn");
  const bellPop = document.getElementById("bellPop");
  bellBtn.addEventListener("click", (e) => { e.stopPropagation(); bellPop.hidden = !bellPop.hidden; });
  document.addEventListener("click", (e) => { if (!bellPop.contains(e.target)) bellPop.hidden = true; });

  document.getElementById("dataMonth").textContent = monthName(sh(D.meta.current_month));
  document.getElementById("monthPill").textContent = `الطلب القادم: ${monthName(NEXT)}`;

  const PAGES = {
    home: { title: "الرئيسية", sub: "نظرة عامة على مخزون الصيدلية", render: renderHome },
    med: { title: "الأدوية", sub: "توصية الطلب وتفاصيل كل فئة", render: renderMed },
    perf: { title: "أداء النظام", sub: "أداء النظام على أشهر حقيقية لم يرها أثناء التدريب", render: renderPerf },
  };

  let current = { page: "home", arg: null };

  function route() {
    const [page, arg] = (location.hash.slice(1) || "home").split("/");
    const p = PAGES[page] ? page : "home";
    if (p !== current.page || arg !== current.arg) editing = false;
    current = { page: p, arg };
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === p));
    document.getElementById("pageTitle").textContent = PAGES[p].title;
    document.getElementById("pageSub").textContent = PAGES[p].sub;
    bellPop.hidden = true;
    rerender();
    window.scrollTo(0, 0);
  }

  function rerender() {
    clearCharts();
    PAGES[current.page].render(current.arg);
    updateBell();
  }

  window.addEventListener("hashchange", route);
  route();
})();
