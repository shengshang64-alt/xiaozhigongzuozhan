/* ============================================================================
   小智工作站 · 静态原型外壳 shell.js
   ---------------------------------------------------------------------------
   职责：① 渲染左侧导航 / 顶栏 / 多标签栏 / 屏内 Tab（全部取自 manifest）
        ② 渲染「上一屏 / 全部界面 / 下一屏」翻屏条
        ③ 提供 ⌘K 全局命令面板（可搜索全部 60+ 屏，键盘可达）
        ④ 提供弹窗 / 抽屉 / 折叠 / 复选等静态交互（纯前端，无后端）
   页面只需：
     <body data-mod="customer" data-screen="customer-list">
     <div id="shell-side"></div> … <div id="shell-top"></div> <div id="shell-tabs"></div>
     <div class="content">…内容…</div>
   ========================================================================== */
(function () {
  const P = window.PROTO;
  if (!P) return;

  const mod = document.body.dataset.mod || "home";
  const screenId = document.body.dataset.screen || "";
  const BASE = document.body.dataset.base || "../";

  /* ---------- 图标（lucide 风格极简描边，统一 1.7 线宽） ---------- */
  const I = {
    grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    arrowLR: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    images: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    fileCheck: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/>',
    bot: '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    userCog: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h4"/><circle cx="17" cy="17" r="3"/><path d="M17 12v2M17 20v2M12.5 14.5l1.4 1.4M20.1 19.1l1.4 1.4M12.5 19.5l1.4-1.4M20.1 14.9l1.4-1.4"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5M12 3v12"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    chevU: '<path d="m18 15-6-6-6 6"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    trending: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
    play: '<path d="m6 3 14 9-14 9z"/>',
    pause: '<path d="M8 4v16M16 4v16"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    pie: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    kanban: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5 18 10l3-3-2.5-2.5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 14 3-4 4 3 5-7"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    building2: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18z"/><path d="M2 22h20M10 6h4M10 10h4M10 14h4M10 18h4"/>',
    wand: '<path d="m15 4 5 5M3 21 17 7M14 4l6 6"/><path d="M9 3v2M5 7h2M19 15v2M17 19h2"/>',
    scale: '<path d="M12 3v18M8 21h8"/><path d="m3 7 4-4 4 4"/><path d="M5 7 3 14h8z"/><path d="m13 7 4-4 4 4"/><path d="m21 7-2 7h-8z"/>',
    filter2: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    paperclip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    presentation: '<path d="M2 3h20M4 3v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3"/><path d="m9 21 3-5 3 5"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
    wifi: '<path d="M5 12.5a11 11 0 0 1 14 0"/><path d="M8.5 16a6 6 0 0 1 7 0"/><path d="M12 20h.01"/><path d="M2 9a16 16 0 0 1 20 0"/>',
  };
  const ic = (n, cls) => `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${I[n] || I.info}</svg>`;

  /* ---------- 当前模块/屏 ---------- */
  const allScreens = [];
  Object.entries(P.mods).forEach(([mkey, m]) => {
    m.screens.forEach((s, i) => allScreens.push({ ...s, mod: mkey, modLabel: m.label, idx: i, total: m.screens.length }));
  });
  const curScreen = allScreens.find((s) => s.id === screenId) || allScreens[0];
  const curMod = P.mods[mod] || P.mods[curScreen.mod];

  /* ---------- 侧栏 ---------- */
  function renderSide() {
    const el = document.getElementById("shell-side");
    if (!el) return;
    let html = `<aside class="side"><div class="side-brand"><div class="logo">智</div><div><b>售前工作台</b><span>PRESALES DESK</span></div></div><nav class="side-nav">`;
    P.nav.forEach((g) => {
      html += `<div class="nav-grp">${g.group}</div>`;
      g.items.forEach((it) => {
        const m = P.mods[it.mod];
        const first = m ? m.screens[0].file : "";
        const on = it.mod === mod ? " on" : "";
        const badge = it.badge ? `<span class="cnt">${it.badge}</span>` : "";
        html += `<button class="nav-item${on}" onclick="location.href='${BASE}${first}'">${ic(it.icon)}<span class="lbl">${it.label}</span>${badge}</button>`;
      });
    });
    html += `</nav><div class="side-foot"><div class="avatar">系</div><div class="who"><b>系统管理员</b><span>医疗售前工程师</span></div></div></aside>`;
    el.outerHTML = html;
  }

  /* ---------- 顶栏 ---------- */
  function renderTop() {
    const el = document.getElementById("shell-top");
    if (!el) return;
    const html = `<header class="topbar">
      <button class="icon-btn" title="折叠/展开导航">${ic("list")}</button>
      <div class="crumb"><span>售前工作台</span><span class="sep">/</span><span>${curMod.group}</span><span class="sep">/</span><b>${curMod.label}</b>${curScreen.tab ? `<span class="sep">/</span><span>${curScreen.tab}</span>` : ""}</div>
      <div class="grow"></div>
      <div class="tb-badge">${ic("sparkles")}<span>Open Design · deepseek-v4.1</span></div>
      <button class="icon-btn" title="通知">${ic("bell")}</button>
      <div class="search-box" onclick="Proto.openPalette()">${ic("search")}<span>搜索客户、标书、情报…</span><kbd>⌘K</kbd></div>
      <button class="icon-btn" title="个性化外观">${ic("settings")}</button>
      <div class="row" style="gap:7px"><div class="avatar sq">系</div><div><div style="font-size:12.5px;font-weight:600;line-height:1.2">系统管理员</div><div style="font-size:10.5px;color:var(--ink-4)">管理员</div></div></div>
    </header>`;
    el.outerHTML = html;
  }

  /* ---------- 多标签栏 ---------- */
  function renderTabs() {
    const el = document.getElementById("shell-tabs");
    if (!el) return;
    const tabs = (P.openTabs || []).map((id) => allScreens.find((s) => s.id === id)).filter(Boolean);
    if (!tabs.find((t) => t.mod === mod)) tabs.push(curScreen);
    let html = `<div class="tabs">`;
    tabs.forEach((t) => {
      const on = t.mod === mod ? " on" : "";
      html += `<button class="tab${on}" onclick="location.href='${BASE}${t.mod === mod ? t.file : t.file}'">${t.modLabel}${t.total > 1 ? " · " + t.tab : ""}<span class="x">×</span></button>`;
    });
    html += `<button class="tab" onclick="location.href='${BASE}index.html'" style="color:var(--ink-4)">＋</button></div>`;
    el.outerHTML = html;
  }

  /* ---------- 屏内 Tab ---------- */
  function renderSubtabs() {
    const host = document.querySelector("[data-subtabs]");
    if (!host) return;
    if (curMod.screens.length < 2) { host.remove(); return; }
    let html = `<div class="subtabs">`;
    curMod.screens.forEach((s) => {
      const on = s.id === screenId ? " on" : "";
      html += `<button class="subtab${on}" onclick="location.href='${BASE}${s.file}'">${s.tab}</button>`;
    });
    html += `<span class="hint">${curScreen.desc || ""}</span></div>`;
    host.outerHTML = html;
  }

  /* ---------- 翻屏条 ---------- */
  function renderPager() {
    const host = document.querySelector("[data-pager]");
    if (!host) return;
    const i = allScreens.findIndex((s) => s.id === (curScreen.id));
    const prev = allScreens[i - 1];
    const next = allScreens[i + 1];
    host.innerHTML = `<div class="row" style="padding:22px 0 6px;border-top:1px solid var(--line);margin-top:26px;gap:10px">
      <div class="small muted-2">界面 ${String(i + 1).padStart(2, "0")} / ${allScreens.length} · ${curMod.label} · ${curScreen.tab}</div>
      <div class="grow"></div>
      ${prev ? `<button class="btn btn--sm" onclick="location.href='${BASE}${prev.file}'">${ic("chevL")} ${prev.modLabel} · ${prev.tab}</button>` : ""}
      <button class="btn btn--sm" onclick="location.href='${BASE}index.html'">${ic("grid")} 全部界面</button>
      ${next ? `<button class="btn btn--sm btn--primary" onclick="location.href='${BASE}${next.file}'">${next.modLabel} · ${next.tab} ${ic("chevR")}</button>` : ""}
    </div>`;
  }

  /* ---------- 命令面板（⌘K） ---------- */
  function paletteHtml() {
    let html = `<div class="mask" id="proto-palette" onclick="if(event.target===this)Proto.closePalette()" style="display:none;align-items:flex-start;padding-top:12vh">
      <div class="modal" style="--mw:640px">
        <div class="row" style="padding:12px 14px;border-bottom:1px solid var(--line);gap:9px">
          <span style="width:16px;height:16px;flex:0 0 16px;color:var(--ink-4);display:block">${ic("search")}</span><input id="proto-pal-input" class="input" style="border:0;height:26px;padding:0;font-size:14px" placeholder="搜索界面：客户 / 标书 / 报价 / 资质…" oninput="Proto.filterPalette(this.value)">
          <kbd style="font-family:var(--font-mono);font-size:10px;border:1px solid var(--line);border-radius:4px;padding:1px 5px;color:var(--ink-4)">ESC</kbd>
        </div>
        <div id="proto-pal-list" style="max-height:52vh;overflow:auto;padding:6px"></div>
        <div class="modal-f" style="justify-content:flex-start;gap:14px;font-size:11px;color:var(--ink-4)">
          <span>↑↓ 选择</span><span>↵ 打开</span><span>共 ${allScreens.length} 个界面</span>
        </div>
      </div></div>`;
    return html;
  }
  function filterPalette(q) {
    const list = document.getElementById("proto-pal-list");
    const kw = (q || "").trim().toLowerCase();
    const rows = allScreens.filter((s) => !kw || (s.modLabel + s.tab + s.desc + s.id).toLowerCase().includes(kw));
    list.innerHTML = rows.length
      ? rows.map((s, n) => `<div class="dd-item" data-i="${n}" onclick="location.href='${BASE}${s.file}'">
          <span style="width:22px;height:22px;border-radius:5px;background:var(--bg-2);display:grid;place-items:center;color:var(--ink-3)">${ic("file")}</span>
          <span style="min-width:0"><b style="font-weight:600;color:var(--ink)">${s.modLabel}</b>
          <span style="color:var(--ink-4)"> · </span>${s.tab}
          <span class="small muted-2" style="margin-left:8px">${s.desc || ""}</span></span>
          <span class="small muted-2 mono" style="margin-left:auto;flex:0 0 auto">${s.mod}</span></div>`).join("")
      : `<div class="empty empty--plain"><h4>没有匹配的界面</h4><p>试试「标书」「报价」「资质」「客户」</p></div>`;
  }
  const Proto = {
    openPalette() {
      const el = document.getElementById("proto-palette");
      if (el) { el.style.display = "grid"; const i = document.getElementById("proto-pal-input"); i.value = ""; filterPalette(""); i.focus(); }
    },
    closePalette() { const e = document.getElementById("proto-palette"); if (e) e.style.display = "none"; },
    filterPalette,
    /* 弹窗 */
    open(id) { document.querySelectorAll("[data-modal='" + id + "']").forEach((e) => (e.style.display = "grid")); },
    close(id) { document.querySelectorAll("[data-modal='" + id + "']").forEach((e) => (e.style.display = "none")); },
    toggleFold(el) { const b = el.nextElementSibling; if (b) b.style.display = b.style.display === "none" ? "block" : "none"; },
    toast(msg) {
      let t = document.getElementById("proto-toast");
      if (!t) {
        t = document.createElement("div");
        t.id = "proto-toast";
        t.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:200;background:var(--ink);color:#fff;padding:8px 14px;border-radius:8px;font-size:12.5px;box-shadow:var(--sh-3);opacity:0;transition:.2s";
        document.body.appendChild(t);
      }
      t.textContent = msg || "已保存";
      t.style.opacity = "1";
      clearTimeout(t._tm);
      t._tm = setTimeout(() => (t.style.opacity = "0"), 1600);
    },
  };
  window.Proto = Proto;

  /* ---------- 常见静态交互委托 ---------- */
  function wire() {
    document.addEventListener("click", (e) => {
      /* 下拉打开/关闭 */
      const trig = e.target.closest("[data-dd]");
      document.querySelectorAll(".dd.open").forEach((d) => { if (!d.contains(e.target)) d.classList.remove("open"); });
      if (trig) { const dd = trig.closest(".dd"); if (dd) dd.classList.toggle("open"); }
      const item = e.target.closest(".dd-item");
      if (item && item.closest(".dd")) {
        const dd = item.closest(".dd");
        dd.querySelectorAll(".dd-item").forEach((x) => x.classList.remove("on"));
        item.classList.add("on");
        dd.classList.remove("open");
        const t = dd.querySelector("[data-dd-label]");
        if (t) t.textContent = item.dataset.label || item.textContent.trim();
        if (item.dataset.toast) Proto.toast(item.dataset.toast);
      }
      /* 复选行选中 */
      const row = e.target.closest("[data-select-row]");
      if (row && !e.target.closest("button,a,input")) {
        const host = row.closest("[data-select-group]");
        if (host) host.querySelectorAll("[data-select-row]").forEach((r) => r.classList.remove("on"));
        row.classList.add("on");
      }
      /* 分段 / chip 单选 */
      const seg = e.target.closest("[data-seg] > button, [data-chips] > .chip");
      if (seg) {
        const host = seg.parentElement;
        host.querySelectorAll(".on").forEach((x) => x.classList.remove("on"));
        seg.classList.add("on");
      }
      /* 折叠 */
      const fh = e.target.closest("[data-fold]");
      if (fh) Proto.toggleFold(fh);
      /* toast */
      const tb = e.target.closest("[data-toast]");
      if (tb) Proto.toast(tb.dataset.toast);
      /* 开关 */
      const sw = e.target.closest(".switch[data-toggle]");
      if (sw) sw.classList.toggle("on");
      /* 关闭遮罩 */
      if (e.target.classList.contains("mask")) e.target.style.display = "none";
    });
    document.addEventListener("keydown", (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); Proto.openPalette(); }
      if (e.key === "Escape") {
        Proto.closePalette();
        document.querySelectorAll(".mask").forEach((m) => (m.style.display = "none"));
        document.querySelectorAll(".dd.open").forEach((d) => d.classList.remove("open"));
      }
    });
  }

  /* ---------- 启动 ---------- */
  renderSide();
  renderTop();
  renderTabs();
  renderSubtabs();
  renderPager();
  document.body.insertAdjacentHTML("beforeend", paletteHtml());
  wire();
})();
