(() => {
  const SUGGESTIONS = [
    "ما الأدوية التي قد تنفد هذا الشهر؟",
    "كم الكمية المقترحة من الباراسيتامول؟ ولماذا؟",
    "ماذا يحدث لو طُلبت 500 علبة باراسيتامول فقط؟",
    "أيهما أقرب للنفاد: الإيبوبروفين أم الأسبرين؟",
  ];

  const history = [];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const num = (v) => (typeof v !== "number" ? v : Number.isInteger(v) && v >= 1900 && v <= 2100 ? String(v) : Math.round(v).toLocaleString("en-US"));

  function summary(t) {
    const r = t.result || {};
    if (r.error) return `خطأ: ${r.error}`;
    switch (t.tool) {
      case "get_inventory":       return `${num(r.on_hand)} وحدة · ${r.status}`;
      case "forecast":            return `[${r.values.map(num).join("، ")}]`;
      case "calculate_order":     return `${num(r.recommended)} وحدة`;
      case "simulate_order":      return `نفاد ${num(r.lost_units)} · تلف ${num(r.expired)} · تلبية ${r.fill_rate}%`;
      case "compare_drugs":       return `${r.a.name} ↔ ${r.b.name}`;
      case "list_critical_drugs": return `${r.count} أدوية`;
      case "explain_seasonality": return r.peak_months.length ? `ذروة: ${(r.peak_periods || r.peak_months).join(" | ")}` : "بدون ذروة واضحة";
      case "compare_policies":    return `الأفضل: ${r.best}`;
      case "query_sales":         return `${r.row_count} صف`;
      default:                    return "تم";
    }
  }
  const argText = (a) => Object.values(a || {}).map((v) => (typeof v === "string" && v.length > 40 ? "…" : v)).join(", ");

  function md(text) {
    const lines = esc(text).split("\n");
    let html = "", inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      const h = line.match(/^#{1,4}\s+(.*)$/);
      html += h ? `<h5>${h[1]}</h5>` : line.trim() ? `<p>${line}</p>` : "";
    }
    return html + (inList ? "</ul>" : "");
  }

  function tableHTML(t) {
    const r = t.result;
    const rows = r.rows.slice(0, 20);
    return `<div class="chat-table"><table>
      <thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(num(v))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>${r.rows.length > 20 ? `<small>أول 20 صفاً من ${r.rows.length}</small>` : ""}
    <details><summary>الاستعلام</summary><code dir="ltr">${esc(t.args.sql)}</code></details></div>`;
  }

  function traceHTML(trace) {
    if (!trace.length) return "";
    return `<div class="chat-trace">🔧 ${trace.length === 1 ? "استُخدمت أداة واحدة" : trace.length === 2 ? "استُخدمت أداتان" : `استُخدمت ${trace.length} أدوات`}:
      <ul>${trace.map((t) => `<li><code dir="ltr">${esc(t.tool)}(${esc(argText(t.args))})</code> ← ${esc(summary(t))}</li>`).join("")}</ul></div>`;
  }

  const root = document.createElement("div");
  root.innerHTML = `
    <button class="chat-fab" id="chatFab" aria-label="المساعد الذكي">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>
      <span>اسأل المساعد</span>
    </button>
    <section class="chat-panel" id="chatPanel" hidden>
      <header>
        <div><b>مساعد PharmaStock</b><span>يجيب من بيانات نظامك</span></div>
        <button class="icon-btn" id="chatClose" aria-label="إغلاق">✕</button>
      </header>
      <div class="chat-body" id="chatBody">
        <div class="chat-msg bot"><p>أهلاً بك في مساعد المخزون. أجيب من بيانات النظام عن: الطلبات، والتوقعات، و"ماذا لو"، والمقارنات، وتحليل المبيعات.</p></div>
        <div class="chat-suggest" id="chatSuggest">${SUGGESTIONS.map((s) => `<button class="chip">${s}</button>`).join("")}</div>
      </div>
      <form class="chat-input" id="chatForm">
        <input id="chatText" autocomplete="off" placeholder="السؤال..." maxlength="1000">
        <button class="btn btn-primary" type="submit">إرسال</button>
      </form>
    </section>`;
  document.body.appendChild(root);

  const panel = document.getElementById("chatPanel");
  const body = document.getElementById("chatBody");
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatText");

  document.getElementById("chatFab").onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) input.focus(); };
  document.getElementById("chatClose").onclick = () => (panel.hidden = true);
  document.getElementById("chatSuggest").onclick = (e) => {
    const b = e.target.closest("button");
    if (b) send(b.textContent);
  };
  form.onsubmit = (e) => { e.preventDefault(); send(input.value); };

  function add(cls, html) {
    const div = document.createElement("div");
    div.className = `chat-msg ${cls}`;
    div.innerHTML = html;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text) return;
    document.getElementById("chatSuggest")?.remove();
    input.value = "";
    add("user", `<p>${esc(text)}</p>`);
    const wait = add("bot typing", "<p>يفكر… ويستدعي أدوات النظام</p>");
    form.querySelector("button").disabled = true;
    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json().catch(() => ({}));
      wait.remove();
      if (!res.ok) {
        add("bot error", `<p>${esc(data.error || "حدث خطأ في الخادم.")}</p>`);
        return;
      }
      const tables = data.tool_trace.filter((t) => t.tool === "query_sales" && t.result && t.result.columns);
      add("bot", md(data.answer) + tables.map(tableHTML).join("") + traceHTML(data.tool_trace));
      history.push({ role: "user", text }, { role: "model", text: data.answer });
    } catch (e) {
      wait.remove();
      add("bot error", "<p>تعذّر الوصول لخادم المساعد. يرجى التأكد من تشغيل الخادم ثم المحاولة مرة ثانية.</p>");
    } finally {
      form.querySelector("button").disabled = false;
      input.focus();
    }
  }
})();
