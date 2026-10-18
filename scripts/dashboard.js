/* 未知之地 · 候选看板（渲染层）
   数据与全部统计由 scripts/gen_dashboard.py 计算后注入 DATA；本文件只负责渲染，
   不自行解析报告、不自行算数。样式见 dashboard_template.html。 */
"use strict";

/* ---------- 数据层 ----------
   gen_dashboard.py 把「解析 + 全部确定性统计」的结果注入 DATA；这里只把它映射成
   渲染函数需要的形状（渲染函数与设计稿一一对应，不感知数据来源）。 */

const DIST_TIP = "圈内＝你熟悉、常关注的领域；圈边＝和熟悉领域沾点边；圈外＝完全陌生的新领域";
const CLS = { 圈内: "in", 圈边: "edge", 圈外: "out" };
const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const REPORTS = (DATA.reports || []).slice();            // 已按日期倒序（新 → 旧）
const DATES = REPORTS.map(r => r.date).reverse();        // 日期条用升序
let curDate = REPORTS.length ? REPORTS[0].date : null;   // 默认最新一份

/* 以下变量在切换日期时由 syncFromData() 重算 */
let curReport = null;
let DAILY = [];        // 柱图：近 N 个报告日产出
let DIST = [];         // 堆叠条：近 N 个报告日累计
let DIST_TODAY = [];   // 三环：当日分布
let CANDS = [];        // 候选名单行
let KW = [];           // 当日关键词
let SRCS = {};         // { code: [{t,u}] }
let CANDS_DOC = [];    // 轮播卡
const PROF = DATA.prof || [];
const PROF_TOTAL = DATA.prof_total || 0;
const SEEN = (DATA.seen || []).map(r => [r.code, r.name, r.first_seen, r.distance]);

function syncFromData() {
  curReport = REPORTS.find(r => r.date === curDate) || null;
  const res = curReport ? curReport.cands : [];
  CANDS_DOC = res.map(c => ({
    no: c.no, nm: c.name, cd: c.code, dist: c.distance, sector: c.sector || "",
    logic: c.logic || "", trigger: c.trigger || "", srcs: c.sources || [],
    pref: c.pref || "", why: c.why || "", risk: c.risk || "",
  }));
  CANDS = res.map(c => ({ d: c.distance, cls: CLS[c.distance], nm: c.name, cd: c.code, logic: c.logic || "" }));
  KW = res.filter(c => c.keyword).map(c => ({ t: c.keyword, cd: c.code }));
  SRCS = Object.fromEntries(res.map(c => [c.code, c.sources || []]));
  DIST_TODAY = (curReport && curReport.dist) || [];
  DAILY = DATA.daily || [];
  DIST = DATA.dist_win || [];
  candIdx = 0;
}

/* ---------- 渲染 ---------- */
const $ = (id) => document.getElementById(id);

function renderHeroBars() {
  if (!DAILY.length) { $("barsNote").innerHTML = ""; $("heroBars").innerHTML = ""; return; }
  const max = Math.max(...DAILY.map(x => x.n));
  const total = DAILY.reduce((s, x) => s + x.n, 0);
  const avg = total / DAILY.length;
  /* 汇总行：让「一共多少、平均多少」一眼可见 */
  $("barsNote").innerHTML = `近 ${DAILY.length} 个报告日共 <b>${total}</b> 只 · 日均 <b>${avg.toFixed(1)}</b> 只`;
  /* 柱子：每根柱子顶上标数字，高度按真实比例（区别更明显），虚线为日均线 */
  $("heroBars").innerHTML = DAILY.map((x) => {
    const today = x.date === curDate;
    const h = Math.max(6, Math.round((x.n / max) * 100));
    return `<div class="bar-col${today ? " today" : ""}">
      <div class="bar-n">${x.n}</div>
      <div class="bar-slot"><div class="bar" style="height:${h}%"></div></div>
      <div class="bar-lb">${x.d}</div>
    </div>`;
  }).join("");
  /* 日均线位置：柱区高 112px，上方数字区约 17px、下方日期区约 17px，槽高 78px */
  const slotH = 112 - 34;
  const bottomPct = ((17 + slotH * (avg / max)) / 112) * 100;
  const line = document.createElement("div");
  line.className = "avg-line";
  line.style.bottom = bottomPct.toFixed(1) + "%";
  line.title = `日均 ${avg.toFixed(1)} 只（虚线）`;
  $("heroBars").appendChild(line);
}

function renderDonuts() {
  const R = 34, C = 2 * Math.PI * R;
  $("donuts").innerHTML = DIST_TODAY.map(d => {
    const dash = (d.pct / 100) * C;
    return `<div class="donut">
      <svg viewBox="0 0 84 84">
        <circle class="track" cx="42" cy="42" r="${R}" fill="none" stroke-width="9"></circle>
        <circle cx="42" cy="42" r="${R}" fill="none" stroke="${d.c}" stroke-width="9"
          stroke-linecap="round" stroke-dasharray="${dash} ${C - dash}"></circle>
      </svg>
      <div class="pct-wrap"><div class="pct">${d.pct}%</div></div>
      <div class="lb" title="${DIST_TIP}">${d.k}</div>
      <div class="cnt">${d.n} 只</div>
    </div>`;
  }).join("");
}

/* 橙卡右上：今日关键词（每只一个词，点击滚动到候选卡看依据） */
function renderHeroSide() {
  $("heroSide").innerHTML = KW.map(k =>
    `<button class="kw" title="${k.cd} · 点击看入选依据">${k.t}</button>`).join("");
  $("heroSide").querySelectorAll(".kw").forEach(el => el.onclick = () => {
    document.querySelector(".cands").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* 紫卡底部：近 7 日累计分布（次要信息：一条堆叠条 + 图例小字） */
function renderDistToday() {
  const total = DIST.reduce((s, d) => s + d.n, 0);
  $("distToday").innerHTML =
    `<div class="dt-label">近 ${DATA.window_days || DIST.length} 个报告日累计 · ${total} 只</div>` +
    `<div class="wk-track">` +
    DIST.map(d => `<div class="wk-seg" style="width:${d.pct}%;background:${d.c}"></div>`).join("") +
    `</div>` +
    `<div class="dt-legend">` +
    DIST.map(d => `<span><i style="background:${d.c}"></i>${d.k} ${d.pct}%</span>`).join("") +
    `</div>`;
}

function renderCands() {
  $("candList").innerHTML = CANDS.map(c => `
    <div class="cand">
      <span class="pill ${c.cls}" title="${DIST_TIP}">${c.d}</span>
      <div class="who"><div class="nm">${c.nm}</div><div class="cd">${c.cd}</div></div>
      <div class="logic">${c.logic}</div>
      <button class="src" data-cd="${c.cd}" title="这条候选的信息来源，点击查看原始出处">来源 ${(SRCS[c.cd] || []).length} 个</button>
      <span class="go" data-cd="${c.cd}" title="跳到报告看这只的完整依据">↗</span>
    </div>`).join("");

  $("candList").querySelectorAll(".src").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); toggleSrcPop(btn); };
  });
  $("candList").querySelectorAll(".go").forEach(go => {
    go.onclick = () => jumpToCand(go.dataset.cd);
  });
}

function renderProf() {
  const max = Math.max(...PROF.map(x => x.n));
  $("profRows").innerHTML = PROF.map(x => `
    <div class="prof-row">
      <div class="p-top"><span>${x.k}</span><span class="n">${x.n} 只</span></div>
      <div class="p-track"><div class="p-fill" style="width:${Math.round(x.n / max * 100)}%"></div></div>
    </div>`).join("");
}

/* 已收录候选：分页浏览（每页 10 行，一屏放得下），筛选时自动回到第 1 页 */
let seenFilterStr = "", seenPage = 0;
const SEEN_PER = 10;

function renderSeen() {
  const f = seenFilterStr.trim().toLowerCase();
  const rows = SEEN.filter(r => !f || r.join(" ").toLowerCase().includes(f));
  const pages = Math.max(1, Math.ceil(rows.length / SEEN_PER));
  seenPage = Math.max(0, Math.min(seenPage, pages - 1));
  const slice = rows.slice(seenPage * SEEN_PER, (seenPage + 1) * SEEN_PER);
  const pillCls = { 圈内: "in", 圈边: "edge", 圈外: "out" };
  $("seenBody").innerHTML = slice.map(r => `
    <tr>
      <td class="code">${r[0]}</td><td>${r[1]}</td><td class="code">${r[2]}</td>
      <td><span class="pill ${pillCls[r[3]]}" style="width:auto" title="${DIST_TIP}">${r[3]}</span></td>
    </tr>`).join("") || `<tr><td colspan="4" style="color:var(--sub)">${
      SEEN.length ? "没有匹配的候选" : "还没有已收录的候选——成功跑过一次之后，这里会记录推荐过的每一只股票"}</td></tr>`;

  const p = $("seenPager");
  if (!SEEN.length) { p.innerHTML = ""; return; }
  /* 标题已写明总数，这里只给当下这屏的有效信息：这一页几只 / 筛出几只 */
  const cnt = f ? `筛出 ${rows.length} 只` : `本页 ${slice.length} 只`;
  if (rows.length <= SEEN_PER) {
    p.innerHTML = `<span class="pg-info">${cnt}</span>`;
    return;
  }
  p.innerHTML =
    `<span class="pg-info">${cnt}</span>` +
    `<button class="pdot pg-arrow" data-p="${seenPage - 1}" title="上一页" ${seenPage === 0 ? "disabled" : ""}>‹</button>` +
    Array.from({ length: pages }, (_, i) =>
      `<button class="pdot${i === seenPage ? " on" : ""}" data-p="${i}" title="第 ${i + 1} 页">${i + 1}</button>`).join("") +
    `<button class="pdot pg-arrow" data-p="${seenPage + 1}" title="下一页" ${seenPage === pages - 1 ? "disabled" : ""}>›</button>`;
  p.querySelectorAll(".pdot").forEach(b => b.onclick = () => {
    seenPage = Math.max(0, Math.min(pages - 1, +b.dataset.p));
    renderSeen();
  });
}

let candIdx = 0;

function renderFlow() {
  if (!CANDS_DOC.length) {
    $("flowDots").innerHTML = "";
    $("flowCard").innerHTML = "<div style='color:var(--sub);font-size:13.5px;line-height:1.9'>本日无合适候选。报告只做候选发现，宁缺毋滥——找不到就不凑数。</div>";
    return;
  }
  const c = CANDS_DOC[candIdx];
  if (!c) return;
  const pc = { 圈内: "in", 圈边: "edge", 圈外: "out" }[c.dist];
  $("flowCard").innerHTML = `
    <div class="fc-top">
      <span class="pill ${pc}" style="width:auto" title="${DIST_TIP}">${c.dist}</span>
      <span class="fc-nm">${c.nm}</span>
      <span class="fc-cd">${c.cd}</span>
      <span class="fc-sector" title="完整赛道：${c.sector}"><i>领域/赛道</i>${c.sector}</span>
    </div>
    <div class="fc-logic">${c.logic}</div>
    <div class="fc-grid${c.why ? "" : " single"}">
      <div class="fc-col"><div class="fc-lb">触发事件</div><div>${c.trigger}</div></div>
      ${c.why ? `<div class="fc-col"><div class="fc-lb">为什么算「陌生 / 发散」</div><div>${c.why}</div></div>` : ""}
    </div>
    <div class="fc-srcs">
      <div class="fc-lb">信息来源 · ${c.srcs.length} 个</div>
      <div class="fc-chips">${c.srcs.map(s => `<a class="fc-chip" href="${s.u}" target="_blank" rel="noopener" title="${s.t}">↗ ${s.t}</a>`).join("")}</div>
    </div>
    <div class="fc-foot">
      <span>对应你的偏好：${c.pref}</span>
      ${c.risk ? `<span class="fc-risk">⚠ ${c.risk}</span>` : ""}
    </div>`;
  $("flowDots").innerHTML = CANDS_DOC.map((x, i) =>
    `<button class="pdot${i === candIdx ? " on" : ""}" data-i="${i}" title="${x.nm}（${x.cd}）">${i + 1}</button>`).join("");
  $("flowDots").querySelectorAll(".pdot").forEach(b => b.onclick = () => goCand(+b.dataset.i));
}

function goCand(i) {
  if (!CANDS_DOC.length) return;
  candIdx = (i + CANDS_DOC.length) % CANDS_DOC.length;
  renderFlow();
}

/* ---------- 卡片文案（全部取自 DATA 的确定性统计，前端不再算数）---------- */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderEmpty() {
  const has = REPORTS.length > 0;
  $("bento").style.display = has ? "" : "none";
  const el = $("emptyState");
  el.style.display = has ? "none" : "";
  if (!has) el.innerHTML = "还没有任何报告。首次使用请先在项目目录执行 <code>/setup</code> 完成配置，"
    + "再运行 <code>./run.sh</code>；产出报告后这里就会出现看板。";
}

function renderHeroMeta() {
  const elD = $("heroDate"), elN = $("heroNum"), el = $("heroDelta");
  if (!curReport) { elD.textContent = elN.textContent = el.textContent = ""; return; }
  const wd = WEEKDAY[new Date(curReport.date + "T00:00:00").getDay()];
  elD.textContent = `${curReport.date}（${wd}）`;
  elN.textContent = curReport.n;
  const idx = REPORTS.findIndex(r => r.date === curReport.date);
  const prev = idx >= 0 ? REPORTS[idx + 1] : null;
  if (!prev) { el.textContent = "没有更早的报告可比较"; el.removeAttribute("title"); return; }
  const diff = curReport.n - prev.n;
  el.textContent = diff === 0 ? "与上个报告日持平"
    : `比上个报告日${diff > 0 ? "多" : "少"} ${Math.abs(diff)} 只`;
  el.title = `上一个报告日（${prev.date.slice(5)}）产出 ${prev.n} 只，当日 ${curReport.n} 只`;
}

function renderDistMeta() {
  $("distMeta").textContent = curReport ? `${curReport.date} · 当日 ${curReport.n} 只` : "";
}

const OPEN_BUDGET = 20;   // 与 AGENT.md 的「硬上限：打开网页 ≤ 20 次」保持一致

function renderStatus() {
  if (!curReport) return;
  const st = curReport.stats || {};
  const opened = st.opened, retry = st.retry || 0;
  const overBudget = opened != null && opened > OPEN_BUDGET;
  const over = overBudget || retry > 0;

  $("statusIcon").className = "sicon " + (over ? "warn" : "ok");
  const tag = $("stateTag");
  tag.className = "state-tag " + (over ? "warn" : "ok");
  const items = [];
  if (overBudget) items.push(`打开网页 ${opened} 次、超出 ${opened - OPEN_BUDGET} 次预算`);
  if (retry > 0) items.push(`${retry} 次是原链接打不开后换入口重试`);
  tag.textContent = over ? `需留意 · ${items.length} 项` : "正常完成";
  tag.title = over ? `需要留意：${items.join("；")}（不影响本次结果）` : "本次运行正常完成";

  $("statusReport").textContent = curReport.run_ok ? "报告已生成 · 校验通过" : "报告已生成";
  const row = $("statusOpenedRow"), dot = $("statusOpenedDot"), txt = $("statusOpened");
  if (opened == null) {
    row.style.display = "none";
  } else {
    row.style.display = "";
    dot.className = "dot" + (overBudget ? " warn-dot" : "");
    txt.textContent = `打开网页 ${opened} 次` + (overBudget ? ` · 超预算 ${opened - OPEN_BUDGET} 次` : "");
    txt.title = `打开网页 ${opened} 次、预算 ${OPEN_BUDGET} 次`
      + (retry > 0 ? `；超出的 ${retry} 次是原链接打不开后换入口重试` : "") + "，不影响本次结果";
  }
}

function renderSched() {
  const s = DATA.schedule, row = $("schedRow");
  if (!s) { row.style.display = "none"; return; }
  row.style.display = "";
  const t = $("schedText");
  t.textContent = `下次自动运行 · ${s.text}`;
  t.title = `定时任务按「${s.text}」自动运行（本机时区）`;
}

const SRC_COLORS = ["#4C6FFF", "#E8901D", "#1FA97A", "#7B78E8"];
const SRC_TIPS = {
  "公告": "直接来自披露平台（巨潮资讯 / 交易所 / 港交所披露易）的公司公告，最权威的一手材料",
  "一手披露": "直接来自披露平台（巨潮资讯 / 交易所 / 港交所披露易）的公司公告，最权威的一手材料",
  "财经网站": "东方财富、新浪财经、同花顺等财经网站的页面",
  "失败重试": "原链接打不开，换别的入口重试的次数（不影响结果）",
};

function renderSources() {
  const rows = (curReport && curReport.sources) || [];
  $("srcRows").innerHTML = rows.map((s, i) => `
    <div class="src-row">
      <div class="s-top"><span class="tip" title="${esc(SRC_TIPS[s.k] || "")}">${esc(s.k)}</span><span class="n">${s.n} 次</span></div>
      <div class="s-track"><div class="s-fill" style="width:${s.pct}%;background:${SRC_COLORS[i % SRC_COLORS.length]}"></div></div>
    </div>`).join("")
    || `<div style="color:var(--sub);font-size:12.5px">报告「说明」行未记录来源构成</div>`;
  const st = (curReport && curReport.stats) || {};
  $("srcFootOpened").textContent = st.opened != null ? `打开网页 ${st.opened} 次` : "打开网页次数未记录";
  $("srcFootSearch").textContent = st.search != null ? `关键词搜索 ${st.search} 次` : "关键词搜索次数未记录";
}

function renderProfMeta() {
  $("profMeta").textContent = `${PROF_TOTAL} 只分在 ${PROF.length} 个方向 · 近 ${DATA.window_days || 0} 个报告日`;
  const outer = (DATA.dist_win || []).find(d => d.k === "圈外") || { n: 0 };
  $("profFoot").innerHTML = `<span class="tip" title="${esc(DIST_TIP)}">圈外 ${outer.n} 只</span> · 赛道不重复 ✓`;
}

function renderSeenMeta() {
  $("seenH2").textContent = `已收录候选 · ${SEEN.length} 只`;
}

function renderReport() {
  const t = $("docTitle"), h = $("docHead");
  if (!curReport) { t.textContent = "候选发现"; h.innerHTML = ""; return; }
  t.innerHTML = `候选发现 <span class="date-pill">${esc(curReport.date)}</span>`;
  h.innerHTML = [curReport.window, curReport.note].filter(Boolean)
    .map(x => `<blockquote>${esc(x)}</blockquote>`).join("");
}

function renderAll() {
  updateCrumb();
  renderEmpty();
  renderHeroMeta();
  renderHeroBars();
  renderHeroSide();
  renderDistMeta();
  renderDonuts();
  renderDistToday();
  renderStatus();
  renderSched();
  renderCands();
  renderSources();
  renderProf();
  renderProfMeta();
  renderSeenMeta();
  renderSeen();
  renderReport();
  renderFlow();
}

/* ---------- 交互 ---------- */
let curView = "overview";
const VIEW_NAMES = { overview: "概览", report: "报告原文", seen: "已收录候选" };

/* 日期选择：最多同屏 6 个（滚动窗口），左右 ‹ › 翻页，「全部 ▾」下拉列出所有日期 */
const PER_VIEW = 6;
let wStart = Math.max(0, DATES.length - PER_VIEW);

function selectDate(d) {
  curDate = d;
  const idx = DATES.indexOf(d);
  if (idx >= 0) {
    if (idx < wStart) wStart = idx;
    if (idx >= wStart + PER_VIEW) wStart = idx - PER_VIEW + 1;
  }
  syncFromData();
  renderChips();
  renderAll();
}

function updateCrumb() {
  const tail = curDate ? ` <span class="dim">/ ${curDate}</span>` : "";
  $("crumb").innerHTML = `${VIEW_NAMES[curView]}${tail}`;
}

function renderChips() {
  /* 还没有任何报告时，不显示日期条（避免出现一个点开是空的下拉） */
  if (!DATES.length) {
    $("dateChips").innerHTML = "";
    $("dateDrop").innerHTML = "";
    return;
  }
  wStart = Math.min(wStart, Math.max(0, DATES.length - PER_VIEW));
  const win = DATES.slice(wStart, wStart + PER_VIEW);
  let html = "";
  if (wStart > 0) html += `<span class="chip nav" data-step="-1" title="更早的日期">‹</span>`;
  html += win.map(d =>
    `<span class="chip ${d === curDate ? "active" : ""}" data-d="${d}">${d}</span>`).join("");
  if (wStart + PER_VIEW < DATES.length) html += `<span class="chip nav" data-step="1" title="更近的日期">›</span>`;
  html += `<span class="chip all" id="allBtn" title="列出全部日期">全部 ▾</span>`;
  $("dateChips").innerHTML = html;

  $("dateChips").querySelectorAll(".chip[data-d]").forEach(el => el.onclick = () => selectDate(el.dataset.d));
  $("dateChips").querySelectorAll(".chip[data-step]").forEach(el => el.onclick = () => {
    wStart = Math.max(0, Math.min(DATES.length - PER_VIEW, wStart + Number(el.dataset.step)));
    renderChips();
  });
  $("allBtn").onclick = (e) => {
    e.stopPropagation();
    toggleDateDrop();
  };
  renderDateDrop();
}

function renderDateDrop() {
  const items = [...DATES].reverse().map(d => {
    const r = REPORTS.find(x => x.date === d);
    return `<div class="dd-i ${d === curDate ? "on" : ""}" data-d="${d}"><span>${d}</span><span>${r ? r.n : "–"} 只</span></div>`;
  }).join("");
  $("dateDrop").innerHTML = `<div class="dd-t">全部报告日（共 ${REPORTS.length} 个有产出）</div>` + items;
  $("dateDrop").querySelectorAll(".dd-i").forEach(el => el.onclick = () => {
    selectDate(el.dataset.d);
    $("dateDrop").classList.remove("open");
  });
}

function toggleDateDrop() {
  $("dateDrop").classList.toggle("open");
}
document.addEventListener("click", (e) => {
  const drop = $("dateDrop");
  if (drop && !drop.contains(e.target) && e.target.id !== "allBtn") drop.classList.remove("open");
});

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 3000);
}

function switchView(name) {
  document.querySelectorAll(".nav-item").forEach(x =>
    x.classList.toggle("active", x.dataset.view === name));
  /* 「已收录」导航项按需出现：只在该页展示，离开即隐藏 */
  document.querySelector(".nav-seen").style.display = name === "seen" ? "" : "none";
  document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
  $("view-" + name).classList.add("active");
  curView = name;
  updateCrumb();
  closeSrcPop();
  $("dateDrop").classList.remove("open");
}

function jumpToCand(cd) {
  switchView("report");
  const i = CANDS_DOC.findIndex(x => x.cd === cd);
  if (i >= 0) {
    goCand(i);
    setTimeout(() => document.querySelector(".flow").scrollIntoView({ block: "nearest" }), 60);
  } else toast("预览数据未包含该条（正式版报告含全部候选）");
}

/* 键盘：报告页内 ← → 逐张切换候选卡 */
document.addEventListener("keydown", (e) => {
  if (curView !== "report") return;
  if (e.key === "ArrowLeft") { e.preventDefault(); goCand(candIdx - 1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); goCand(candIdx + 1); }
});

/* 来源弹层 */
function closeSrcPop() {
  const p = document.querySelector(".srcpop");
  if (p) p.remove();
}
function toggleSrcPop(btn) {
  const host = btn.closest(".cand");
  const existing = host.querySelector(".srcpop");
  closeSrcPop();
  if (existing) return;
  const cd = btn.dataset.cd;
  const links = SRCS[cd] || [];
  const pop = document.createElement("div");
  pop.className = "srcpop";
  pop.innerHTML = `<div class="sp-t">信息来源 · ${links.length} 个</div>` +
    links.map(l => `<a class="sp-link" href="${l.u}" target="_blank" rel="noopener">↗ <span>${l.t}</span></a>`).join("") +
    `<button class="sp-detail">查看详情 · 报告对应段落</button>`;
  pop.onclick = (e) => e.stopPropagation();
  pop.querySelector(".sp-detail").onclick = () => jumpToCand(cd);
  host.appendChild(pop);
  const r = pop.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8) pop.classList.add("up");
}
document.addEventListener("click", closeSrcPop);

document.querySelectorAll(".nav-item").forEach(el => {
  el.onclick = () => switchView(el.dataset.view);
});
$("cornerDist").onclick = () => switchView("seen");
$("cornerCands").onclick = () => switchView("report");
$("cornerSources").onclick = () => switchView("report");
$("cornerSeen").onclick = () => switchView("overview");

/* 侧栏缩进 / 展开（默认缩进） */
const sideBtn = $("sideBtn");
sideBtn.onclick = (e) => {
  e.stopPropagation();
  const rail = document.body.classList.toggle("rail");
  sideBtn.innerHTML = rail ? '⇥<span class="lbl">展开导航</span>' : '⇤<span class="lbl">收起导航</span>';
  sideBtn.title = rail ? "展开导航" : "收起导航";
  try { localStorage.setItem("sd-rail", rail ? "1" : "0"); } catch (_) {}
};
/* 首次打开默认展开（可见项目名）；用户主动收起后记住选择 */
try {
  if (localStorage.getItem("sd-rail") === "1") {
    document.body.classList.add("rail");
    sideBtn.innerHTML = '⇥<span class="lbl">展开导航</span>';
    sideBtn.title = "展开导航";
  }
} catch (_) {}

$("seenFilter").oninput = e => { seenFilterStr = e.target.value; seenPage = 0; renderSeen(); };
$("flowPrev").onclick = () => goCand(candIdx - 1);
$("flowNext").onclick = () => goCand(candIdx + 1);

/* ---------- 启动 ---------- */
syncFromData();
renderChips();
renderAll();
