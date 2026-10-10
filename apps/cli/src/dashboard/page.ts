// 生成私人看板（一个独立的 HTML 文件，数据直接写在页面里，不联网也能打开）。
//
// 设计：页面围绕“驿传赛道”展开——计划的每一周是一个区间，每次测试跑是一个中继站，
// 襷色（深红）只用在赛道和测试跑上；图表数据统一用蓝色，次要信息用灰色。

import { WEEKDAY_NAMES, addDays, distanceName, fmtDuration, isoWeekday, localDate, mondayOf, shortDate } from "#engine/format.ts";
import { assessGoal, deadlineMs } from "#engine/goals/progress.ts";
import { efforts } from "#engine/metrics/performance.ts";
import { runRules } from "#engine/rules/index.ts";
import { loadCard } from "#knowledge";
import type { Context } from "../context.ts";
import { courseStrip, heartRateChart, trendChart, volumeChart, weekBars } from "./charts.ts";
import { esc, markdownToHtml } from "./markdown.ts";

const longDate = (ymd: string) => `${Number(ymd.slice(5, 7))} 月 ${Number(ymd.slice(8, 10))} 日`;

function statusChip(kind: "good" | "serious" | "neutral", text: string): string {
  const icon = kind === "good" ? "✓" : kind === "serious" ? "▲" : "·";
  return `<span class="chip chip-${kind}"><span aria-hidden="true">${icon}</span>${esc(text)}</span>`;
}

function hero(ctx: Context): string {
  const goal = ctx.goal;
  if (!goal) {
    return `<section class="hero"><h1>还没有目标</h1>
      <p class="lede">在终端运行 <code>npm run goal -- set --distance 5 --time 30:00 --by 2026-11-30</code>，再重新生成这个页面。</p></section>`;
  }
  const p = assessGoal(goal, ctx.activities, ctx.now, ctx.tests);
  const weeks = Math.max(0, p.weeksLeft);
  const chip =
    p.status === "achieved" ? statusChip("good", "已达成")
    : p.status === "on-track" ? statusChip("good", "进度正常")
    : p.status === "behind" ? statusChip("serious", "进度落后")
    : statusChip("neutral", p.status === "expired" ? "已过截止日" : "暂时无法预测");
  const level = p.current
    ? `现在的水平折合 <strong>${fmtDuration(p.current.equivalentSec)}</strong>` +
      (p.gapSec && p.gapSec > 0 ? `，还差 ${fmtDuration(p.gapSec)}。` : "。") +
      (p.basis === "test" ? "来自最近一次测试跑。" : "由训练跑估算，测试跑之后会更准。")
    : "最近 4 周没有可以估算成绩的跑步。";

  return `<section class="hero">
    <h1>${distanceName(goal.distanceM)} 跑进 ${fmtDuration(goal.targetSec)}</h1>
    <p class="lede">截止 ${longDate(goal.deadline)}，还有 ${weeks.toFixed(1)} 周。${level} ${chip}</p>
    <div class="scroll">${courseStrip(ctx.matches, goal, ctx.today)}</div>
    <p class="legend">
      <span><svg width="28" height="10"><line x1="2" y1="5" x2="26" y2="5" class="course-done"/></svg>已跑过的路段</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" class="dot-done"/></svg>完成的课</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" class="dot-missed"/></svg>没跑的课</span>
      <span><svg width="18" height="18"><circle cx="9" cy="9" r="6" class="station"/></svg>测试跑（中继站）</span>
    </p>
  </section>`;
}

function nextUp(ctx: Context): string {
  if (!ctx.goal || ctx.plan.length === 0) return "";
  const thisMonday = mondayOf(ctx.today);
  const hasThisWeek = ctx.matches.some((m) => m.session.date >= thisMonday && m.session.date <= addDays(thisMonday, 6));
  const monday = hasThisWeek ? thisMonday : addDays(thisMonday, 7);
  const week = ctx.matches.filter((m) => m.session.date >= monday && m.session.date <= addDays(monday, 6));
  const next = ctx.matches.find((m) => m.status === "today" || m.status === "upcoming");

  const rows = week
    .map((m) => {
      const state =
        m.status === "done" ? "完成" : m.status === "missed" ? "没跑" : m.status === "today" ? "今天" : "";
      const a = m.activity;
      const actual = a
        ? `${((a.distanceM ?? 0) / 1000).toFixed(1)} km${a.avgHr ? `，心率 ${Math.round(a.avgHr)}` : ""}` +
          (m.session.hrCap && a.avgHr && a.avgHr > m.session.hrCap ? `<span class="over">，超过上限 ${m.session.hrCap}</span>` : "")
        : "";
      return `<li class="s-${m.status}${m.session.kind === "test" ? " is-test" : ""}">
        <span class="when">${WEEKDAY_NAMES[isoWeekday(m.session.date)]} ${shortDate(m.session.date)}</span>
        <span class="what">${esc(m.session.title)}</span>
        <span class="state">${state}${actual ? ` · ${actual}` : ""}</span></li>`;
    })
    .join("");

  const nextBlock = next
    ? `<div class="next">
        <p class="next-when">${next.status === "today" ? "今天" : `下一次 · ${WEEKDAY_NAMES[isoWeekday(next.session.date)]} ${longDate(next.session.date)}`}</p>
        <p class="next-title">${esc(next.session.title)}</p>
        <p class="next-detail">${esc(next.session.detail)}</p>
      </div>`
    : "";

  return `<section>
    <h2>${hasThisWeek ? "这周" : "下周"}的课</h2>
    ${nextBlock}
    <ol class="week">${rows}</ol>
  </section>`;
}

function trendSection(ctx: Context): string {
  const goal = ctx.goal;
  if (!goal) return "";
  const p = assessGoal(goal, ctx.activities, ctx.now, ctx.tests);
  const target = fmtDuration(goal.targetSec);
  const day = (ms: number) => longDate(localDate(new Date(ms).toISOString(), ctx.timeZone));
  let title = "成绩趋势";
  if (p.status === "achieved") title = `已经跑进 ${target}`;
  else if (p.projectedMs && p.status === "behind") {
    const late = Math.max(1, Math.round((p.projectedMs - deadlineMs(goal.deadline)) / (7 * 864e5)));
    title = `照最近的进步速度，${day(p.projectedMs)}前后跑进 ${target}，比截止日晚约 ${late} 周`;
  } else if (p.projectedMs) title = `照最近的进步速度，${day(p.projectedMs)}前后跑进 ${target}，赶得上截止日`;
  else if (p.status === "no-trend") title = "最近没有比之前更快，暂时算不出达成日";

  const rate =
    p.ratePerWeek != null && p.requiredPerWeek != null
      ? `最近每周快约 ${Math.max(0, Math.round(p.ratePerWeek))} 秒，按期达成需要每周快约 ${Math.round(p.requiredPerWeek)} 秒。`
      : "";
  return `<section>
    <h2>${esc(title)}</h2>
    <p class="sub">每个点是一次跑步，按 Riegel 公式换算成 ${distanceName(goal.distanceM)} 的用时，越往上越快。${rate}</p>
    <div class="scroll">${trendChart(efforts(ctx.activities, goal.distanceM), ctx.tests, p, goal, ctx.now, ctx.timeZone)}</div>
    <p class="legend">
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" class="pt"/></svg>训练跑</span>
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="5" class="pt-key"/></svg>现在的水平</span>
      <span><svg width="16" height="16"><path d="M8 1 l7 7 l-7 7 l-7 -7 z" class="pt-test"/></svg>测试跑</span>
      <span><svg width="28" height="10"><line x1="2" y1="5" x2="26" y2="5" class="projection"/></svg>预测</span>
    </p>
  </section>`;
}

function heartSection(ctx: Context): string {
  if (!ctx.hrMax) return "";
  const hrMax = ctx.hrMax.value;
  const lim = Math.round(hrMax * 0.8);
  const since = ctx.now.getTime() - 56 * 864e5;
  const easy = ctx.activities.filter(
    (a) => a.sport === "running" && a.avgHr != null && Date.parse(a.start) >= since && !ctx.qualityIds?.has(a.id),
  );
  const over = easy.filter((a) => (a.avgHr as number) > hrMax * 0.8).length;
  const title =
    easy.length === 0
      ? "最近 8 周没有带心率的轻松跑"
      : over === 0
        ? `最近 8 周的 ${easy.length} 次轻松跑，心率都在 ${lim} 以下`
        : `最近 8 周 ${easy.length} 次轻松跑里，${over} 次平均心率超过 ${lim}`;
  return `<section>
    <h2>${esc(title)}</h2>
    <p class="sub">轻松跑应该落在 2 区（灰带）。最大心率 ${hrMax}，${ctx.hrMax.method === "observed" ? "取实测最高值" : ctx.hrMax.method === "manual" ? "手动指定" : "按 220 − 年龄估算"}。</p>
    <div class="scroll">${heartRateChart(ctx.activities.filter((a) => a.sport === "running"), ctx.qualityIds, hrMax, ctx.now, ctx.timeZone)}</div>
    <p class="legend">
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" class="pt-key"/></svg>轻松跑，超过 ${lim}</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" class="pt"/></svg>轻松跑</span>
      ${ctx.qualityIds ? `<span><svg width="12" height="12"><circle cx="6" cy="6" r="4" class="pt-hollow"/></svg>质量课和测试跑</span>` : ""}
    </p>
  </section>`;
}

function volumeSection(ctx: Context): string {
  const bars = weekBars(ctx.activities, ctx.plan, ctx.today, ctx.timeZone);
  const cur = bars.find((b) => b.monday === mondayOf(ctx.today));
  const next = bars.find((b) => b.monday === addDays(mondayOf(ctx.today), 7));
  let title = "每周跑量";
  if (cur?.plannedKm) title = `这周计划 ${cur.plannedKm} km，已经跑了 ${cur.actualKm ?? 0} km`;
  else if (next?.plannedKm) title = `下周计划 ${next.plannedKm} km`;
  else if (cur) title = `这周跑了 ${cur.actualKm ?? 0} km`;
  const rows = bars
    .map((b) => `<tr><td>${shortDate(b.monday)}–${shortDate(addDays(b.monday, 6))}</td><td>${b.actualKm ?? "—"}</td><td>${b.plannedKm ?? "—"}</td></tr>`)
    .join("");
  return `<section>
    <h2>${esc(title)}</h2>
    <p class="sub">按自然周（周一到周日）统计。计划每周增长约 10%，测试周减量。</p>
    <div class="scroll">${volumeChart(bars, ctx.today)}</div>
    <p class="legend">
      <span><svg width="12" height="12"><rect width="12" height="12" rx="2" class="bar-actual"/></svg>实际</span>
      ${ctx.plan.length > 0 ? `<span><svg width="12" height="12"><rect width="12" height="12" rx="2" class="bar-plan"/></svg>计划</span>` : ""}
    </p>
    <details><summary>查看数据表</summary>
      <table><thead><tr><th>周</th><th>实际 km</th><th>计划 km</th></tr></thead><tbody>${rows}</tbody></table>
    </details>
  </section>`;
}

function adviceSection(ctx: Context): string {
  if (!ctx.hrMax) return "";
  const insights = runRules({
    activities: ctx.activities,
    hrMax: ctx.hrMax.value,
    now: ctx.now,
    timeZone: ctx.timeZone,
    goal: ctx.goal,
    tests: ctx.tests,
    qualityActivityIds: ctx.qualityIds,
  });
  if (insights.length === 0) {
    return `<section><h2>没有需要调整的地方</h2><p class="sub">按计划继续跑。</p></section>`;
  }
  const items = insights
    .map((ins) => {
      const card = ins.cardId ? loadCard(ins.cardId) : null;
      const cardBlock = card
        ? `<details class="card"><summary>为什么：${esc(card.title)}${card.status === "reviewed" ? "" : "<span class=\"draft\">草稿，待审核</span>"}</summary>
            <div class="card-body">${markdownToHtml(card.body)}</div></details>`
        : "";
      return `<article class="advice">
        <h3>${ins.severity === "warning" ? '<span class="warn" aria-hidden="true">▲</span>' : ""}${esc(ins.title)}</h3>
        <p>${esc(ins.finding)}</p>
        <p class="todo"><strong>怎么做</strong>${esc(ins.suggestion)}</p>
        <ul class="assume">${ins.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        ${cardBlock}
      </article>`;
    })
    .join("");
  return `<section><h2>建议</h2>${items}</section>`;
}

const STYLE = `
:root {
  color-scheme: light;
  --paper: #f4f6f8; --ink: #1c2433; --ink-2: #4b5568; --ink-3: #7a8496;
  --rule: #d9dee5; --grid: #e2e6eb; --sash: #b3243a;
  --data: #2a78d6; --data-light: #9ec5f4; --muted: #a3acb9; --band: rgba(42, 120, 214, 0.09);
  --serious: #c2410c; --serious-bg: #fde7dc; --good: #0a7d0a; --good-bg: #dcf3dc;
  --serif: "Songti SC", "STSong", "Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", serif;
  --sans: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --paper: #12161d; --ink: #e8ecf2; --ink-2: #b4bcc8; --ink-3: #8a93a3;
    --rule: #2a313c; --grid: #232933; --sash: #d6495f;
    --data: #3987e5; --data-light: #1c5cab; --muted: #5e6878; --band: rgba(57, 135, 229, 0.13);
    --serious: #f29a70; --serious-bg: #3a2218; --good: #5fcf5f; --good-bg: #17301a;
  }
}
* { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 15px; line-height: 1.7; font-variant-numeric: tabular-nums; }
main { max-width: 880px; margin: 0 auto; padding: 40px 24px 64px; }
header.top { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; color: var(--ink-3); font-size: 13px; }
.brand { font-family: var(--serif); font-size: 18px; color: var(--ink); letter-spacing: 0.04em; }
.brand b { color: var(--sash); font-weight: 700; margin-left: 4px; }
h1 { font-family: var(--serif); font-weight: 700; font-size: 46px; line-height: 1.15; margin: 28px 0 12px; letter-spacing: 0.01em; }
h2 { font-family: var(--serif); font-weight: 700; font-size: 22px; line-height: 1.4; margin: 0 0 6px; max-width: 34em; }
h3 { font-size: 16px; margin: 0 0 6px; }
section { margin-top: 56px; }
section.hero { margin-top: 0; }
.lede { font-size: 17px; color: var(--ink-2); max-width: 40em; margin: 0 0 8px; }
.lede strong { color: var(--ink); font-family: var(--serif); font-size: 20px; }
.sub { color: var(--ink-2); margin: 0 0 12px; max-width: 46em; }
code { font-size: 0.92em; background: var(--grid); padding: 1px 5px; border-radius: 4px; }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; padding: 1px 10px; border-radius: 999px; vertical-align: 2px; margin-left: 4px; white-space: nowrap; }
.chip-serious { color: var(--serious); background: var(--serious-bg); }
.chip-good { color: var(--good); background: var(--good-bg); }
.chip-neutral { color: var(--ink-2); background: var(--grid); }
svg.chart { display: block; width: 100%; height: auto; margin: 8px 0 4px; overflow: visible; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 20px; font-size: 13px; color: var(--ink-2); margin: 4px 0 0; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend svg { overflow: visible; }
.empty { color: var(--ink-3); }

/* 赛道 */
.course-rest { stroke: var(--rule); stroke-width: 5; stroke-linecap: round; }
.course-done { stroke: var(--sash); stroke-width: 9; stroke-linecap: round; }
.t-station { font-family: var(--serif); font-size: 16px; font-weight: 700; fill: var(--ink); }
.course-tick { stroke: var(--ink-3); stroke-width: 1; }
.dot-done { fill: var(--sash); stroke: var(--paper); stroke-width: 2; }
.dot-missed { fill: var(--paper); stroke: var(--ink-3); stroke-width: 1.5; }
.dot-todo { fill: var(--muted); stroke: var(--paper); stroke-width: 2; }
.station { fill: var(--paper); stroke: var(--sash); stroke-width: 4; }
.station-final { fill: var(--sash); stroke: var(--paper); stroke-width: 4; }
.today-mark { fill: var(--ink); }

/* 图表 */
.t-small { font-size: 13px; fill: var(--ink-2); }
.t-strong { fill: var(--ink); font-weight: 600; }
.t-quiet { fill: var(--ink-3); }
.t-axis { font-size: 12px; fill: var(--ink-3); }
.grid { stroke: var(--grid); stroke-width: 1; }
.axis { stroke: var(--ink-3); stroke-width: 1; }
.ref { stroke: var(--ink-2); stroke-width: 1; }
.band { fill: var(--band); }
.projection { stroke: var(--data); stroke-width: 2; stroke-dasharray: 6 5; fill: none; }
.pt { fill: var(--muted); stroke: var(--paper); stroke-width: 2; }
.pt-key { fill: var(--data); stroke: var(--paper); stroke-width: 2; }
.pt-test { fill: var(--sash); stroke: var(--paper); stroke-width: 2; }
.pt-hollow { fill: var(--paper); stroke: var(--ink-3); stroke-width: 2; }
.bar-actual { fill: var(--data); }
.bar-plan { fill: var(--data-light); }
[tabindex]:focus-visible { outline: 2px solid var(--data); outline-offset: 2px; }
#tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--paper); font-size: 13px; line-height: 1.5; padding: 6px 10px; border-radius: 6px; max-width: 280px; opacity: 0; transition: opacity 0.12s; z-index: 10; }

/* 课表 */
.next { border-left: 4px solid var(--sash); padding: 4px 0 4px 16px; margin: 12px 0 20px; }
.next-when { margin: 0; color: var(--ink-3); font-size: 13px; }
.next-title { margin: 2px 0; font-family: var(--serif); font-size: 22px; font-weight: 700; }
.next-detail { margin: 0; color: var(--ink-2); max-width: 44em; }
ol.week { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
ol.week li { display: grid; grid-template-columns: 7.5em 1fr auto; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--rule); align-items: baseline; }
ol.week .when { color: var(--ink-3); font-size: 13px; }
ol.week .state { color: var(--ink-2); font-size: 13px; text-align: right; }
ol.week li.s-done .what { color: var(--ink-2); }
ol.week li.s-done .when::before { content: "✓ "; color: var(--sash); }
ol.week li.s-missed .what { text-decoration: line-through; color: var(--ink-3); }
ol.week li.is-test .what { font-weight: 600; color: var(--sash); }
.over { color: var(--serious); }

/* 建议 */
.advice { padding: 20px 0; border-top: 1px solid var(--rule); max-width: 46em; }
.advice p { margin: 0 0 8px; }
.advice .todo strong { display: block; font-size: 13px; color: var(--ink-3); font-weight: 600; }
.warn { color: var(--serious); margin-right: 6px; font-size: 13px; vertical-align: 1px; }
.assume { margin: 8px 0 0; padding-left: 1.2em; color: var(--ink-3); font-size: 13px; }
details { margin-top: 10px; }
summary { cursor: pointer; color: var(--data); font-size: 14px; }
.draft { margin-left: 8px; font-size: 12px; color: var(--ink-3); border: 1px solid var(--rule); border-radius: 999px; padding: 0 8px; }
.card-body { margin-top: 8px; padding: 4px 0 4px 16px; border-left: 2px solid var(--rule); }
.card-body h4 { font-family: var(--serif); font-size: 16px; margin: 14px 0 4px; }
.card-body .note { color: var(--ink-3); font-size: 13px; }
.card-body ul, .card-body ol { padding-left: 1.3em; margin: 4px 0; }
table { border-collapse: collapse; margin-top: 8px; font-size: 13px; }
th, td { text-align: right; padding: 4px 14px 4px 0; border-bottom: 1px solid var(--rule); }
th:first-child, td:first-child { text-align: left; }
footer { margin-top: 64px; color: var(--ink-3); font-size: 13px; max-width: 46em; }

.scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
@media (max-width: 600px) {
  main { padding: 24px 16px 48px; }
  .scroll svg.chart { min-width: 640px; }
  .scroll svg.course { min-width: 720px; }
  h1 { font-size: 34px; }
  h2 { font-size: 19px; }
  ol.week li { grid-template-columns: 5.5em 1fr; }
  ol.week .state { grid-column: 2; text-align: left; }
}
@media (prefers-reduced-motion: reduce) { #tip { transition: none; } }
`;

const SCRIPT = `
const tip = document.getElementById("tip");
function show(el, x, y) {
  tip.textContent = el.dataset.tip;
  tip.style.opacity = "1";
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 14, innerWidth - r.width - 8) + "px";
  tip.style.top = Math.max(8, y - r.height - 12) + "px";
}
document.addEventListener("pointerover", (e) => { const el = e.target.closest("[data-tip]"); if (el) show(el, e.clientX, e.clientY); });
document.addEventListener("pointermove", (e) => { const el = e.target.closest("[data-tip]"); if (el) show(el, e.clientX, e.clientY); });
document.addEventListener("pointerout", (e) => { if (e.target.closest("[data-tip]")) tip.style.opacity = "0"; });
document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) { const r = el.getBoundingClientRect(); show(el, r.right, r.top); } });
document.addEventListener("focusout", () => { tip.style.opacity = "0"; });
`;

export function renderDashboard(ctx: Context): string {
  const updated = ctx.syncLog
    .map((s) => s.exportedAt ?? s.syncedAt)
    .sort()
    .at(-1);
  const updatedText = updated
    ? `数据截至 ${new Date(updated).toLocaleString("zh-CN", { timeZone: ctx.timeZone, hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tasuki 训练看板</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header class="top"><span class="brand">Tasuki<b>襷</b></span><span>${esc(updatedText)}</span></header>
  ${hero(ctx)}
  ${nextUp(ctx)}
  ${trendSection(ctx)}
  ${heartSection(ctx)}
  ${volumeSection(ctx)}
  ${adviceSection(ctx)}
  <footer>这个页面由 Tasuki 在你的电脑上生成，数据只保存在本机，没有上传到任何地方。配速、心率区间和计划都是按规则估算的训练参考，不是医疗建议。</footer>
</main>
<div id="tip" role="tooltip"></div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
