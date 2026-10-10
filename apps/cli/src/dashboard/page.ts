// 生成私人看板（一个独立的 HTML 文件，数据直接写在页面里，不联网也能打开）。
//
// 视觉：深色背景、青柠色强调、细边框卡片；橙色只用于“襷”——赛道和测试跑。
// 信息层级：导航 → 目标标题 → 四张信息卡（进度、下一次课、本周计划、下一次测试）
//          → 训练赛道 → 成绩 / 心率 / 跑量三个面板 → 建议。

import type { RaceGoal } from "#schema";
import { WEEKDAY_NAMES, addDays, distanceName, fmtDuration, isoWeekday, localDate, mondayOf, shortDate } from "#engine/format.ts";
import { assessGoal, deadlineMs, type GoalProgress } from "#engine/goals/progress.ts";
import { efforts } from "#engine/metrics/performance.ts";
import { runRules } from "#engine/rules/index.ts";
import { loadCard } from "#knowledge";
import type { Context } from "../context.ts";
import { courseStrip, heartRateChart, trendChart, volumeChart, weekBars } from "./charts.ts";
import { esc, markdownToHtml } from "./markdown.ts";

const longDate = (ymd: string) => `${Number(ymd.slice(5, 7))} 月 ${Number(ymd.slice(8, 10))} 日`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

const STATUS: Record<GoalProgress["status"], { text: string; tone: "good" | "warn" | "muted" }> = {
  achieved: { text: "已达成", tone: "good" },
  "on-track": { text: "进度正常", tone: "good" },
  behind: { text: "进度落后", tone: "warn" },
  "no-trend": { text: "暂无法预测", tone: "muted" },
  "no-data": { text: "缺少数据", tone: "muted" },
  expired: { text: "已过截止日", tone: "muted" },
};

// ---------- 顶部 ----------

function nav(ctx: Context): string {
  const updated = ctx.syncLog.map((s) => s.exportedAt ?? s.syncedAt).sort().at(-1);
  const when = updated
    ? new Date(updated).toLocaleString("zh-CN", { timeZone: ctx.timeZone, hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  return `<nav class="nav">
    <a class="logo" href="#top"><span class="mark">襷</span><span class="name">Tasuki</span><span class="slash">/</span><span class="sub">训练教练</span></a>
    <div class="links">
      <a href="#goal" class="on">目标</a><a href="#course">计划</a><a href="#trend">趋势</a><a href="#advice">建议</a>
    </div>
    <div class="source"><span class="live"></span>Apple Watch${when ? ` · 数据截至 ${esc(when)}` : ""}</div>
  </nav>`;
}

function hero(ctx: Context, goal: RaceGoal | null): string {
  if (!goal) {
    return `<header class="hero" id="top">
      <p class="eyebrow">TASUKI · TRAINING</p>
      <h1>先定一个目标，<br>再一步一步跑过去。</h1>
      <p class="lede">在终端运行 <code>npm run goal -- set --distance 5 --time 30:00 --by 2026-11-30</code>，再重新生成这个页面。</p>
    </header>`;
  }
  const finalTest = ctx.matches.filter((m) => m.session.kind === "test").at(-1)?.session.date ?? goal.deadline;
  const year = goal.deadline.slice(0, 4);
  return `<header class="hero" id="top">
    <div>
      <p class="eyebrow">${distanceName(goal.distanceM).replace(" ", "").toUpperCase()} PROJECT · ${year}</p>
      <h1>${longDate(finalTest)}，<br>${distanceName(goal.distanceM)} 跑进 ${fmtDuration(goal.targetSec)}。</h1>
      <p class="lede">每 3 周一次全力测试，大部分跑步放慢、少数几次专门练快。下面是现在的位置，和接下来该怎么跑。</p>
    </div>
    <aside class="hero-side">
      <p class="vertical">襷をつなぐ。</p>
      <div class="side-note"><p>箱根驿传 × 强风吹拂</p><p class="quiet">一棒一棒，跑到终点。</p></div>
    </aside>
  </header>`;
}

// ---------- 四张信息卡 ----------

function paceScale(p: GoalProgress, goal: RaceGoal): string {
  if (!p.current) return "";
  const cur = p.current.equivalentSec;
  const best = p.bestEver?.equivalentSec ?? cur;
  const lo = Math.min(best, goal.targetSec) - 30; // 最快端
  const hi = Math.max(cur, goal.targetSec) + 60; // 最慢端
  const pos = (v: number) => (((hi - v) / (hi - lo)) * 100).toFixed(1);
  return `<div class="scale" role="img" aria-label="现在 ${fmtDuration(cur)}，目标 ${fmtDuration(goal.targetSec)}，最好 ${fmtDuration(best)}">
    <div class="track"><div class="fill" style="width:${pos(cur)}%"></div></div>
    <span class="tick target" style="left:${pos(goal.targetSec)}%"><i></i><b>目标</b></span>
    ${best < cur ? `<span class="tick best" style="left:${pos(best)}%"><i></i><b>最好 ${fmtDuration(best)}</b></span>` : ""}
  </div>`;
}

function goalCard(ctx: Context, goal: RaceGoal, p: GoalProgress): string {
  const s = STATUS[p.status];
  const rate =
    p.ratePerWeek != null && p.requiredPerWeek != null
      ? `<p class="delta ${p.status === "behind" ? "warn" : "good"}">${p.ratePerWeek > 0 ? "↑" : "→"} 每周快 ${Math.max(0, Math.round(p.ratePerWeek))} 秒 · 需要 ${Math.round(p.requiredPerWeek)} 秒</p>`
      : "";
  return `<article class="card">
    <div class="card-head"><span>目标进度</span><span class="tag ${s.tone}">${s.text}</span></div>
    <p class="big">${p.current ? fmtDuration(p.current.equivalentSec) : "—"}<small> / ${fmtDuration(goal.targetSec)}</small></p>
    ${paceScale(p, goal)}
    <div class="card-foot"><span>${p.gapSec && p.gapSec > 0 ? `还差 ${fmtDuration(p.gapSec)}` : p.status === "achieved" ? "已经跑进目标" : ""}</span><span>截止 ${shortDate(goal.deadline)} · ${Math.max(0, p.weeksLeft).toFixed(1)} 周</span></div>
    ${rate}
  </article>`;
}

function nextCard(ctx: Context): string {
  const next = ctx.matches.find((m) => m.status === "today" || m.status === "upcoming");
  if (!next) return `<article class="card"><div class="card-head"><span>下一次课</span></div><p class="big">—</p><p class="card-text">计划里没有接下来的课。</p></article>`;
  const s = next.session;
  const [main, extra] = s.title.split(" + ");
  const when = next.status === "today" ? "今天" : `${WEEKDAY_NAMES[isoWeekday(s.date)]} ${shortDate(s.date)}`;
  const spec = s.hrCap ? `心率 ≤ ${s.hrCap} · 配速不限` : s.paceSecPerKm ? `目标配速 ${fmtDuration(s.paceSecPerKm)}/km` : "";
  return `<article class="card">
    <div class="card-head"><span>下一次课</span><span class="tag">${when}</span></div>
    <p class="big title-big ${s.kind === "test" ? "is-test" : ""}">${esc(main)}</p>
    ${extra ? `<p class="card-text">+ ${esc(extra)}</p>` : ""}
    <div class="card-foot"><span>${esc(spec)}</span><span>${s.distanceKm} km</span></div>
  </article>`;
}

function weekCard(ctx: Context): string {
  const thisMonday = mondayOf(ctx.today);
  const has = (monday: string) => ctx.matches.some((m) => m.session.date >= monday && m.session.date <= addDays(monday, 6));
  const monday = has(thisMonday) || ctx.plan.length === 0 ? thisMonday : addDays(thisMonday, 7);
  const week = ctx.matches.filter((m) => m.session.date >= monday && m.session.date <= addDays(monday, 6));
  const planned = week.reduce((s, m) => s + m.session.distanceKm, 0);
  const actual = ctx.activities
    .filter((a) => a.sport === "running" && localDate(a.start, ctx.timeZone) >= monday && localDate(a.start, ctx.timeZone) <= addDays(monday, 6))
    .reduce((s, a) => s + (a.distanceM ?? 0) / 1000, 0);
  const done = week.filter((m) => m.status === "done").length;
  const days = [1, 2, 3, 4, 5, 6, 7]
    .map((d) => {
      const date = addDays(monday, d - 1);
      const m = week.find((x) => x.session.date === date);
      const cls = [
        m ? "planned" : "",
        m?.status === "done" ? "done" : "",
        m?.status === "missed" ? "missed" : "",
        m?.session.kind === "test" ? "test" : "",
        date === ctx.today ? "today" : "",
      ].filter(Boolean).join(" ");
      const label = m ? `${shortDate(date)} ${m.session.title}` : `${shortDate(date)} 休息`;
      return `<li class="${cls}" data-tip="${esc(label)}" tabindex="0"><span class="dname">${WEEKDAY_NAMES[d].slice(1)}</span><span class="dnum">${Number(date.slice(8))}</span></li>`;
    })
    .join("");
  return `<article class="card">
    <div class="card-head"><span>${monday === thisMonday ? "本周计划" : "下周计划"}</span><span class="tag">${shortDate(monday)} — ${shortDate(addDays(monday, 6))}</span></div>
    <p class="big">${planned}<small> km</small></p>
    <ol class="cal">${days}</ol>
    <div class="card-foot"><span>完成 ${done} / ${week.length} 次</span><span>${monday === thisMonday ? `已跑 ${actual.toFixed(1)} km` : "明天开始"}</span></div>
  </article>`;
}

function testCard(ctx: Context, goal: RaceGoal): string {
  const tests = ctx.matches.filter((m) => m.session.kind === "test");
  const idx = tests.findIndex((m) => m.status !== "done" && m.session.date >= ctx.today);
  const last = [...tests].reverse().find((m) => m.status === "done");
  if (idx === -1) {
    return `<article class="card"><div class="card-head"><span>测试跑</span></div><p class="big">—</p><p class="card-text">计划里的测试都已经完成。</p></article>`;
  }
  const t = tests[idx];
  const left = daysBetween(ctx.today, t.session.date);
  const lastText = last?.activity?.distanceM
    ? `上次 ${fmtDuration(last.activity.durationSec * Math.pow(goal.distanceM / last.activity.distanceM, 1.06))}`
    : "还没有测试成绩";
  return `<article class="card">
    <div class="card-head"><span>下一次测试</span><span class="tag sash">第 ${idx + 1} / ${tests.length} 站</span></div>
    <p class="big">${shortDate(t.session.date)}<small> ${left === 0 ? "今天" : `还有 ${left} 天`}</small></p>
    <p class="card-text">${idx === tests.length - 1 ? "目标测试：冲击" : "全力跑"} ${distanceName(goal.distanceM)}${idx === tests.length - 1 ? ` ${fmtDuration(goal.targetSec)}` : ""}，热身和放松单独记录。</p>
    <div class="card-foot"><span>${lastText}</span><span>测完运行 npm run plan</span></div>
  </article>`;
}

// ---------- 面板 ----------

function panel(id: string, eyebrow: string, title: string, sub: string, body: string, legend = "", after = ""): string {
  return `<section class="panel" id="${id}">
    <header class="panel-head"><p class="eyebrow">${eyebrow}</p><h2>${esc(title)}</h2>${sub ? `<p class="panel-sub">${sub}</p>` : ""}</header>
    <div class="scroll">${body}</div>
    ${legend ? `<p class="legend">${legend}</p>` : ""}
    ${after}
  </section>`;
}

const sw = (cls: string, shape: "dot" | "line" | "bar" | "ring" | "diamond" | "thick") =>
  shape === "dot" ? `<svg width="12" height="12"><circle cx="6" cy="6" r="4" class="${cls}"/></svg>`
  : shape === "ring" ? `<svg width="18" height="18"><circle cx="9" cy="9" r="6" class="${cls}"/></svg>`
  : shape === "line" ? `<svg width="26" height="10"><line x1="2" y1="5" x2="24" y2="5" class="${cls}"/></svg>`
  : shape === "thick" ? `<svg width="26" height="12"><line x1="4" y1="6" x2="22" y2="6" class="${cls}"/></svg>`
  : shape === "diamond" ? `<svg width="14" height="14"><path d="M7 1 l6 6 l-6 6 l-6 -6 z" class="${cls}"/></svg>`
  : `<svg width="12" height="12"><rect width="12" height="12" rx="2" class="${cls}"/></svg>`;

function coursePanel(ctx: Context, goal: RaceGoal): string {
  if (ctx.plan.length === 0) {
    return panel("course", "THE COURSE", "还没有训练计划", "运行 <code>npm run plan</code> 生成到截止日的计划。", "");
  }
  const tests = ctx.matches.filter((m) => m.session.kind === "test").length;
  const weeks = new Set(ctx.matches.map((m) => mondayOf(m.session.date))).size;
  const done = ctx.matches.filter((m) => m.status === "done").length;
  const sub = `每周一个区间，每次测试跑是一个中继站。已完成 ${done} / ${ctx.matches.length} 次课。`;
  return panel(
    "course",
    `THE COURSE TO ${shortDate(ctx.matches.at(-1)!.session.date)}`,
    `${weeks} 周，${tests} 个中继站`,
    sub,
    courseStrip(ctx.matches, goal, ctx.today),
    `<span>${sw("course-done", "thick")}已跑过的路段</span><span>${sw("dot-done", "dot")}完成的课</span><span>${sw("dot-todo", "dot")}待完成</span><span>${sw("station", "ring")}测试跑</span>`,
  );
}

function trendPanel(ctx: Context, goal: RaceGoal, p: GoalProgress): string {
  const target = fmtDuration(goal.targetSec);
  const day = (ms: number) => longDate(localDate(new Date(ms).toISOString(), ctx.timeZone));
  let title = "成绩趋势";
  if (p.status === "achieved") title = `已经跑进 ${target}`;
  else if (p.projectedMs && p.status === "behind") {
    const late = Math.max(1, Math.round((p.projectedMs - deadlineMs(goal.deadline)) / (7 * 864e5)));
    title = `照现在的进步速度，${day(p.projectedMs)}前后跑进 ${target}，比截止日晚约 ${late} 周`;
  } else if (p.projectedMs) title = `照现在的进步速度，${day(p.projectedMs)}前后跑进 ${target}`;
  else if (p.status === "no-trend") title = "最近没有比之前更快，暂时算不出达成日";
  return panel(
    "trend",
    "PACE TREND",
    title,
    `每个点是一次跑步，按 Riegel 公式换算成 ${distanceName(goal.distanceM)} 的用时，越往上越快。`,
    trendChart(efforts(ctx.activities, goal.distanceM), ctx.tests, p, goal, ctx.now, ctx.timeZone),
    `<span>${sw("pt", "dot")}训练跑</span><span>${sw("pt-key", "dot")}现在的水平</span><span>${sw("pt-test", "diamond")}测试跑</span><span>${sw("projection", "line")}预测</span>`,
  );
}

function heartPanel(ctx: Context): string {
  if (!ctx.hrMax) return "";
  const hrMax = ctx.hrMax.value;
  const lim = Math.round(hrMax * 0.8);
  const since = ctx.now.getTime() - 56 * 864e5;
  const easy = ctx.activities.filter(
    (a) => a.sport === "running" && a.avgHr != null && Date.parse(a.start) >= since && !ctx.qualityIds?.has(a.id),
  );
  const over = easy.filter((a) => (a.avgHr as number) > hrMax * 0.8).length;
  const title =
    easy.length === 0 ? "最近 8 周没有带心率的轻松跑"
    : over === 0 ? `最近 8 周 ${easy.length} 次轻松跑，心率都在 ${lim} 以下`
    : `最近 8 周 ${easy.length} 次轻松跑里，${over} 次平均心率超过 ${lim}`;
  const how = ctx.hrMax.method === "observed" ? "取实测最高值" : ctx.hrMax.method === "manual" ? "手动指定" : "按 220 − 年龄估算";
  return panel(
    "heart",
    "HEART RATE",
    title,
    `轻松跑应该落在 2 区（带状区域）。最大心率 ${hrMax}，${how}。`,
    heartRateChart(ctx.activities.filter((a) => a.sport === "running"), ctx.qualityIds, hrMax, ctx.now, ctx.timeZone),
    `<span>${sw("pt-key", "dot")}轻松跑，超过 ${lim}</span><span>${sw("pt", "dot")}轻松跑</span>${ctx.qualityIds ? `<span>${sw("pt-hollow", "dot")}质量课和测试跑</span>` : ""}`,
  );
}

function volumePanel(ctx: Context): string {
  const bars = weekBars(ctx.activities, ctx.plan, ctx.today, ctx.timeZone);
  const total = bars.filter((b) => b.monday > mondayOf(ctx.today)).reduce((s, b) => s + (b.plannedKm ?? 0), 0);
  const title = total > 0 ? `接下来 ${bars.filter((b) => b.monday > mondayOf(ctx.today) && b.plannedKm).length} 周计划 ${total} km` : "每周跑量";
  const rows = bars
    .map((b) => `<tr><td>${shortDate(b.monday)}–${shortDate(addDays(b.monday, 6))}</td><td>${b.actualKm ?? "—"}</td><td>${b.plannedKm ?? "—"}</td></tr>`)
    .join("");
  return panel(
    "volume",
    "WEEKLY DISTANCE",
    title,
    "按自然周统计。计划每周增长约 10%，任何一周不超过前 4 周平均的 1.25 倍，测试周减量。",
    volumeChart(bars, ctx.today),
    `<span>${sw("bar-actual", "bar")}实际</span>${ctx.plan.length > 0 ? `<span>${sw("bar-plan", "bar")}计划</span>` : ""}`,
    `<details><summary>查看数据表</summary><table><thead><tr><th>周</th><th>实际 km</th><th>计划 km</th></tr></thead><tbody>${rows}</tbody></table></details>`,
  );
}

function advice(ctx: Context): string {
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
  const items = insights.length === 0
    ? `<article class="card advice"><p class="card-text">目前没有需要调整的地方，按计划继续跑。</p></article>`
    : insights
        .map((ins) => {
          const card = ins.cardId ? loadCard(ins.cardId) : null;
          return `<article class="card advice">
            <div class="card-head"><span class="advice-title">${esc(ins.title)}</span><span class="tag ${ins.severity === "warning" ? "warn" : ""}">${ins.severity === "warning" ? "需要注意" : "提示"}</span></div>
            <p>${esc(ins.finding)}</p>
            <p class="todo"><span>怎么做</span>${esc(ins.suggestion)}</p>
            <ul class="assume">${ins.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
            ${card ? `<details><summary>为什么：${esc(card.title)}${card.status === "reviewed" ? "" : `<em>草稿，待审核</em>`}</summary><div class="card-body">${markdownToHtml(card.body)}</div></details>` : ""}
          </article>`;
        })
        .join("");
  return `<section class="block" id="advice">
    <div class="block-head"><h2>教练建议</h2><p>每条建议都写明依据和假设，可以展开看背后的知识。</p></div>
    <div class="advice-grid">${items}</div>
  </section>`;
}

// ---------- 样式 ----------

const STYLE = `
:root {
  color-scheme: dark;
  --bg: #121a1c; --panel: #172022; --panel-2: #1b2725; --line: #27323a; --line-2: #33403f; --grid: #222d30;
  --ink: #e8ede9; --ink-2: #b3bdb7; --ink-3: #7c8883; --dim: #4a5754;
  --lime: #c6e88a; --lime-2: #8fb85a; --lime-soft: rgba(198, 232, 138, 0.14); --plan: #46593a;
  --sash: #e9a65d; --warn: #f0a46c; --warn-bg: rgba(240, 164, 108, 0.12); --good-bg: rgba(198, 232, 138, 0.12);
  --sans: -apple-system, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  --serif: "Hiragino Mincho ProN", "Songti SC", "Noto Serif CJK SC", serif;
}
* { box-sizing: border-box; }
html { background: var(--bg); scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 14px; line-height: 1.65; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration: none; }
code { font-size: 0.92em; background: var(--line); padding: 1px 6px; border-radius: 4px; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 0 40px 80px; }

/* 导航 */
.nav { display: flex; align-items: center; gap: 32px; height: 72px; border-bottom: 1px solid var(--line); margin: 0 -40px; padding: 0 40px; }
.logo { display: flex; align-items: center; gap: 10px; font-size: 16px; }
.mark { width: 36px; height: 36px; border-radius: 9px; background: var(--lime); color: var(--bg); display: grid; place-items: center; font-family: var(--serif); font-weight: 700; font-size: 20px; }
.name { font-weight: 600; }
.slash { color: var(--dim); }
.sub { color: var(--ink-2); font-size: 14px; }
.links { margin-left: auto; display: flex; gap: 28px; color: var(--ink-2); }
.links a:hover, .links a.on { color: var(--lime); }
.source { display: flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: 0.14em; color: var(--ink-3); padding-left: 24px; border-left: 1px solid var(--line); text-transform: uppercase; }
.live { width: 6px; height: 6px; border-radius: 50%; background: var(--lime); }

/* 标题区 */
.hero { display: grid; grid-template-columns: 1fr 240px; gap: 40px; padding: 56px 0 40px; align-items: end; }
.eyebrow { font-size: 11px; letter-spacing: 0.22em; color: var(--lime); margin: 0 0 18px; display: flex; align-items: center; gap: 12px; }
.hero .eyebrow::before { content: ""; width: 24px; height: 1px; background: var(--lime); }
h1 { font-size: 44px; line-height: 1.32; font-weight: 700; margin: 0 0 18px; letter-spacing: 0.01em; }
.lede { color: var(--ink-2); font-size: 14px; max-width: 46em; margin: 0; }
.hero-side { display: flex; gap: 20px; align-items: flex-end; }
.vertical { writing-mode: vertical-rl; font-family: var(--serif); font-size: 17px; letter-spacing: 0.3em; margin: 0; color: var(--ink); }
.side-note { border-top: 1px solid var(--line-2); padding-top: 14px; font-size: 12px; flex: 1; }
.side-note p { margin: 0 0 6px; }
.quiet { color: var(--ink-3); }

/* 区块标题 */
.block { margin-top: 48px; }
.block-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.block-head h2 { font-size: 20px; margin: 0; font-weight: 700; }
.block-head p { margin: 0; color: var(--ink-3); font-size: 12px; }

/* 卡片 */
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 20px 22px; display: flex; flex-direction: column; min-width: 0; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); margin-bottom: 12px; }
.tag { font-size: 11px; letter-spacing: 0.06em; color: var(--ink-3); white-space: nowrap; }
.tag.warn { color: var(--warn); background: var(--warn-bg); padding: 1px 8px; border-radius: 999px; }
.tag.good { color: var(--lime); background: var(--good-bg); padding: 1px 8px; border-radius: 999px; }
.tag.sash { color: var(--sash); }
.big { font-size: 34px; font-weight: 600; line-height: 1.1; margin: 0 0 14px; letter-spacing: -0.01em; }
.big small { font-size: 13px; font-weight: 400; color: var(--ink-3); margin-left: 4px; letter-spacing: 0; }
.title-big { font-size: 22px; line-height: 1.35; margin-bottom: 4px; }
.title-big.is-test { color: var(--sash); }
.card-text { color: var(--ink-2); font-size: 13px; margin: 0 0 10px; }
.card-foot { margin-top: auto; padding-top: 10px; display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--ink-3); }
.delta { font-size: 12px; margin: 8px 0 0; }
.delta.warn { color: var(--warn); }
.delta.good { color: var(--lime); }

/* 配速刻度 */
.scale { position: relative; height: 34px; margin: 2px 0 6px; }
.track { position: absolute; left: 0; right: 0; top: 4px; height: 4px; border-radius: 2px; background: var(--line-2); }
.fill { height: 100%; border-radius: 2px; background: var(--lime); }
.tick { position: absolute; top: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; font-size: 11px; white-space: nowrap; }
.tick i { width: 2px; height: 12px; background: var(--ink); display: block; }
.tick b { font-weight: 400; color: var(--ink-2); margin-top: 3px; }
.tick.best i { background: var(--sash); }
.tick.best b { color: var(--sash); }

/* 一周日历 */
.cal { list-style: none; padding: 0; margin: 0 0 4px; display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; gap: 2px; }
.cal li { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; color: var(--ink-3); border-radius: 6px; padding: 2px 0; }
.cal .dnum { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; color: var(--dim); }
.cal li.planned .dnum { color: var(--ink); border: 1.5px solid var(--lime-2); }
.cal li.test .dnum { border-color: var(--sash); color: var(--sash); }
.cal li.done .dnum { background: var(--lime); color: var(--bg); border-color: var(--lime); }
.cal li.missed .dnum { border-style: dashed; color: var(--ink-3); border-color: var(--ink-3); }
.cal li.today .dname { color: var(--lime); }

/* 面板 */
.panel { margin-top: 20px; background: linear-gradient(180deg, var(--panel-2), var(--panel)); border: 1px solid var(--line); border-radius: 14px; padding: 26px 28px 22px; }
.panel-head .eyebrow { margin-bottom: 8px; color: var(--ink-3); }
.panel-head h2 { font-size: 20px; font-weight: 700; margin: 0 0 4px; line-height: 1.45; }
.panel-sub { margin: 0; color: var(--ink-3); font-size: 13px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 20px; font-size: 12px; color: var(--ink-2); margin: 6px 0 0; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend svg { overflow: visible; }
.scroll { overflow-x: auto; }
svg.chart { display: block; width: 100%; height: auto; margin: 12px 0 4px; overflow: visible; }
.empty { color: var(--ink-3); }

/* 图表元素 */
.course-rest { stroke: var(--line-2); stroke-width: 5; stroke-linecap: round; }
.course-done { stroke: var(--sash); stroke-width: 9; stroke-linecap: round; }
.course-tick { stroke: var(--dim); stroke-width: 1; }
.dot-done { fill: var(--lime); stroke: var(--panel); stroke-width: 2; }
.dot-missed { fill: var(--panel); stroke: var(--ink-3); stroke-width: 1.5; }
.dot-todo { fill: var(--dim); stroke: var(--panel); stroke-width: 2; }
.station { fill: var(--panel); stroke: var(--sash); stroke-width: 4; }
.station-final { fill: var(--sash); stroke: var(--panel); stroke-width: 4; }
.today-mark { fill: var(--lime); }
.t-station { font-size: 16px; font-weight: 600; fill: var(--ink); }
.t-small { font-size: 13px; fill: var(--ink-2); }
.t-strong { fill: var(--ink); font-weight: 600; }
.t-quiet { fill: var(--ink-3); }
.t-axis { font-size: 12px; fill: var(--ink-3); }
.grid { stroke: var(--grid); stroke-width: 1; }
.axis { stroke: var(--dim); stroke-width: 1; }
.ref { stroke: var(--ink-3); stroke-width: 1; }
.band { fill: var(--lime-soft); }
.projection { stroke: var(--lime); stroke-width: 2; stroke-dasharray: 6 5; fill: none; }
.pt { fill: var(--dim); stroke: var(--panel); stroke-width: 2; }
.pt-key { fill: var(--lime); stroke: var(--panel); stroke-width: 2; }
.pt-test { fill: var(--sash); stroke: var(--panel); stroke-width: 2; }
.pt-hollow { fill: var(--panel); stroke: var(--ink-2); stroke-width: 2; }
.bar-actual { fill: var(--lime); }
.bar-plan { fill: var(--plan); }
[tabindex]:focus-visible { outline: 2px solid var(--lime); outline-offset: 2px; }
#tip { position: fixed; pointer-events: none; background: #f2f5f1; color: #121a1c; font-size: 12px; line-height: 1.5; padding: 6px 10px; border-radius: 6px; max-width: 280px; opacity: 0; transition: opacity 0.12s; z-index: 10; }

/* 建议 */
.advice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.advice p { margin: 0 0 10px; color: var(--ink-2); }
.advice-title { color: var(--ink); font-size: 16px; font-weight: 600; }
.advice .todo { color: var(--ink); }
.advice .todo span { display: block; font-size: 11px; letter-spacing: 0.14em; color: var(--lime); margin-bottom: 2px; }
.assume { margin: 0 0 6px; padding-left: 1.1em; color: var(--ink-3); font-size: 12px; }
details { margin-top: 8px; }
summary { cursor: pointer; color: var(--lime); font-size: 13px; }
summary em { font-style: normal; margin-left: 8px; font-size: 11px; color: var(--ink-3); border: 1px solid var(--line-2); border-radius: 999px; padding: 0 8px; }
.card-body { margin-top: 10px; padding-left: 14px; border-left: 2px solid var(--line-2); color: var(--ink-2); font-size: 13px; }
.card-body h4 { color: var(--ink); font-size: 14px; margin: 14px 0 4px; }
.card-body .note { color: var(--ink-3); font-size: 12px; }
.card-body ul, .card-body ol { padding-left: 1.3em; margin: 4px 0; }
table { border-collapse: collapse; margin-top: 8px; font-size: 12px; color: var(--ink-2); }
th, td { text-align: right; padding: 4px 16px 4px 0; border-bottom: 1px solid var(--line); }
th:first-child, td:first-child { text-align: left; }
footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--ink-3); font-size: 12px; display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; }

@media (max-width: 1080px) {
  .cards { grid-template-columns: repeat(2, 1fr); }
  .advice-grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .wrap { padding: 0 16px 56px; }
  .nav { margin: 0 -16px; padding: 0 16px; gap: 16px; height: 60px; }
  .links, .sub, .slash { display: none; }
  .source { margin-left: auto; border-left: none; padding-left: 0; letter-spacing: 0.06em; }
  .hero { grid-template-columns: 1fr; padding: 32px 0 24px; gap: 20px; }
  .hero-side { display: none; }
  h1 { font-size: 30px; }
  .cards { grid-template-columns: 1fr; }
  .panel { padding: 20px 16px 16px; }
  .scroll svg.chart { min-width: 760px; }
  .scroll svg.course { min-width: 860px; }
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
  const goal = ctx.goal;
  const p = goal ? assessGoal(goal, ctx.activities, ctx.now, ctx.tests) : null;
  const body = goal && p
    ? `<section class="block" id="goal">
        <div class="block-head"><h2>我的目标</h2><p>${esc(goal.deadline)} 前 ${distanceName(goal.distanceM)} 跑进 ${fmtDuration(goal.targetSec)}；当前水平${p.basis === "test" ? "来自最近一次测试跑" : "由训练跑估算，测试跑之后会更准"}。</p></div>
        <div class="cards">${goalCard(ctx, goal, p)}${nextCard(ctx)}${weekCard(ctx)}${testCard(ctx, goal)}</div>
      </section>
      ${coursePanel(ctx, goal)}
      ${trendPanel(ctx, goal, p)}
      ${heartPanel(ctx)}
      ${volumePanel(ctx)}
      ${advice(ctx)}`
    : `${heartPanel(ctx)}${volumePanel(ctx)}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#121a1c">
<title>Tasuki · 训练看板</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  ${nav(ctx)}
  ${hero(ctx, goal)}
  ${body}
  <footer><span>由 Tasuki 在你的电脑上生成，数据只保存在本机，没有上传到任何地方。</span><span>配速、心率区间和计划是按规则估算的训练参考，不是医疗建议。</span></footer>
</div>
<div id="tip" role="tooltip"></div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
