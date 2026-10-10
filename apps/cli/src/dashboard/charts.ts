// 看板里的四张图，全部手写 SVG，不依赖图表库。
// 每个数据点带 data-tip（悬停提示）和 tabindex（键盘可聚焦）；颜色全部来自 CSS 变量，深色模式自动切换。

import type { Activity, PlannedSession, RaceGoal } from "#schema";
import { addDays, fmtDuration, fmtPace, localDate, mondayOf, paceOf, shortDate } from "#engine/format.ts";
import type { GoalProgress } from "#engine/goals/progress.ts";
import type { Effort } from "#engine/metrics/performance.ts";
import type { SessionMatch } from "#engine/plan/match.ts";
import { esc } from "./markdown.ts";

const DAY = 864e5;
const W = 1200;

const ymdMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

/** 把 [d0, d1] 映射到 [r0, r1] */
function scale(d0: number, d1: number, r0: number, r1: number) {
  return (v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
}

function tip(text: string): string {
  return `data-tip="${esc(text)}" tabindex="0"`;
}

// ---------- 1. 赛道：从今天到目标测试，每周一个区间，测试跑是中继站 ----------

export function courseStrip(matches: SessionMatch[], goal: RaceGoal, today: string): string {
  if (matches.length === 0) return "";
  const first = mondayOf(matches[0].session.date);
  const finish = matches.at(-1)?.session.date as string;
  const x = scale(ymdMs(first), ymdMs(finish), 40, W - 40);
  const y = 92;
  const todayX = Math.min(Math.max(x(ymdMs(today)), 40), W - 40);

  const parts: string[] = [];
  // 未跑的路段：细灰线；已跑的路段：襷色粗线
  parts.push(`<line x1="40" y1="${y}" x2="${W - 40}" y2="${y}" class="course-rest"/>`);
  if (todayX > 40) parts.push(`<line x1="40" y1="${y}" x2="${todayX}" y2="${y}" class="course-done"/>`);

  // 每周的分界和周序号
  let week = 1;
  for (let monday = first; monday <= finish; monday = addDays(monday, 7)) {
    const x0 = x(ymdMs(monday));
    const x1 = Math.min(x(ymdMs(addDays(monday, 7))), W - 40);
    if (week > 1) parts.push(`<line x1="${x0}" y1="${y - 6}" x2="${x0}" y2="${y + 6}" class="course-tick"/>`);
    parts.push(`<text x="${(x0 + x1) / 2}" y="${y + 30}" class="t-small t-quiet" text-anchor="middle">第 ${week} 周</text>`);
    week++;
  }

  // 每次课一个小点：完成 = 实心，未完成 = 空心
  for (const m of matches) {
    if (m.session.kind === "test") continue;
    const cx = x(ymdMs(m.session.date));
    const cls = m.status === "done" ? "dot-done" : m.status === "missed" ? "dot-missed" : "dot-todo";
    const state = m.status === "done" ? "已完成" : m.status === "missed" ? "未完成" : "待完成";
    parts.push(`<circle cx="${cx}" cy="${y}" r="5" class="${cls}" ${tip(`${shortDate(m.session.date)} ${m.session.title} · ${state}`)}/>`);
  }

  // 中继站：测试跑
  for (const m of matches.filter((m) => m.session.kind === "test")) {
    const cx = x(ymdMs(m.session.date));
    const final = m.session.date === finish;
    const result =
      m.activity && m.activity.distanceM
        ? fmtDuration(m.activity.durationSec * Math.pow(goal.distanceM / m.activity.distanceM, 1.06))
        : null;
    parts.push(`<g ${tip(`${shortDate(m.session.date)} ${m.session.title}${result ? ` · 成绩 ${result}` : ""}`)}>`);
    parts.push(`<circle cx="${cx}" cy="${y}" r="${final ? 14 : 11}" class="${final ? "station-final" : "station"}"/>`);
    parts.push(`<text x="${cx}" y="${y - 28}" class="t-station" text-anchor="${final ? "end" : "middle"}">${final ? "目标测试" : "测试"} ${shortDate(m.session.date)}</text>`);
    if (result) parts.push(`<text x="${cx}" y="${y + 52}" class="t-station" text-anchor="middle">${result}</text>`);
    parts.push(`</g>`);
  }

  // 今天
  parts.push(`<path d="M${todayX} ${y - 14} l-7 -11 h14 z" class="today-mark"/>`);
  parts.push(`<text x="${todayX}" y="${y - 32}" class="t-small t-strong" text-anchor="middle">今天</text>`);

  return `<svg viewBox="0 0 ${W} 156" class="chart course" role="img" aria-label="训练赛道：从今天到 ${shortDate(finish)} 目标测试">${parts.join("")}</svg>`;
}

// ---------- 2. 成绩趋势：每次跑步换算成目标距离的成绩，越往上越快 ----------

export function trendChart(
  all: Effort[],
  tests: Effort[],
  progress: GoalProgress,
  goal: RaceGoal,
  now: Date,
  tz: string,
): string {
  const startMs = now.getTime() - 210 * DAY;
  const pts = all.filter((e) => Date.parse(e.activity.start) >= startMs);
  if (pts.length === 0) return `<p class="empty">最近半年没有可以换算成绩的跑步。</p>`;

  const deadlineMs = ymdMs(goal.deadline);
  const projMs = progress.projectedMs;
  const endMs = Math.max(deadlineMs, Math.min(projMs ?? 0, deadlineMs + 42 * DAY)) + 7 * DAY;
  const values = pts.map((e) => e.equivalentSec).sort((a, b) => a - b);
  const p90 = values[Math.floor(values.length * 0.9)] ?? values.at(-1)!;
  const yTop = Math.floor((Math.min(goal.targetSec, values[0]) - 45) / 60) * 60;
  const yBottom = Math.ceil((p90 + 30) / 60) * 60;
  const L = 64, R = W - 96, T = 24, B = 300;
  const xStart = Math.min(...pts.map((e) => Date.parse(e.activity.start))) - 3 * DAY;
  const x = scale(xStart, endMs, L, R);
  const y = scale(yTop, yBottom, T, B);
  const parts: string[] = [];

  // 网格和刻度（每分钟一条）
  for (let s = yTop; s <= yBottom; s += 60) {
    parts.push(`<line x1="${L}" x2="${R}" y1="${y(s)}" y2="${y(s)}" class="grid"/>`);
    parts.push(`<text x="${L - 10}" y="${y(s) + 4}" class="t-axis" text-anchor="end">${fmtDuration(s)}</text>`);
  }
  // 月份刻度
  const d0 = new Date(xStart);
  for (let m = 0; m < 12; m++) {
    const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1);
    if (t < xStart || t > endMs) continue;
    parts.push(`<text x="${x(t)}" y="${B + 24}" class="t-axis" text-anchor="middle">${new Date(t).getUTCMonth() + 1} 月</text>`);
  }

  // 目标线、截止日
  parts.push(`<line x1="${L}" x2="${R}" y1="${y(goal.targetSec)}" y2="${y(goal.targetSec)}" class="ref"/>`);
  parts.push(`<text x="${R + 8}" y="${y(goal.targetSec) + 4}" class="t-small t-strong">目标 ${fmtDuration(goal.targetSec)}</text>`);
  parts.push(`<line x1="${x(deadlineMs)}" x2="${x(deadlineMs)}" y1="${T}" y2="${B}" class="ref"/>`);
  parts.push(`<text x="${x(deadlineMs) + 6}" y="${T + 12}" class="t-small t-quiet">截止 ${shortDate(goal.deadline)}</text>`);

  // 预测：从当前水平沿进步速度延伸到目标
  const cur = progress.current;
  if (cur && progress.ratePerWeek && progress.ratePerWeek > 0 && projMs) {
    const cx = Date.parse(cur.activity.start);
    const stopMs = Math.min(projMs, endMs - 7 * DAY);
    const stopSec = cur.equivalentSec - (progress.ratePerWeek * (stopMs - cx)) / (7 * DAY);
    parts.push(`<line x1="${x(cx)}" y1="${y(cur.equivalentSec)}" x2="${x(stopMs)}" y2="${y(stopSec)}" class="projection"/>`);
    parts.push(`<circle cx="${x(stopMs)}" cy="${y(stopSec)}" r="4" class="pt-key"/>`);
    parts.push(`<text x="${x(stopMs) - 8}" y="${y(stopSec) - 12}" class="t-small t-strong" text-anchor="end">预计 ${shortDate(localDate(new Date(projMs).toISOString(), tz))}</text>`);
  }

  // 每次跑步
  const testIds = new Set(tests.map((t) => t.activity.id));
  for (const e of pts) {
    if (e.equivalentSec > yBottom || testIds.has(e.activity.id)) continue;
    const a = e.activity;
    const isCur = cur?.activity.id === a.id;
    const label = `${localDate(a.start, tz)} · ${((a.distanceM ?? 0) / 1000).toFixed(2)} km · 配速 ${fmtPace(paceOf(a.durationSec, a.distanceM))} · 折合 ${fmtDuration(e.equivalentSec)}`;
    parts.push(`<circle cx="${x(Date.parse(a.start))}" cy="${y(e.equivalentSec)}" r="${isCur ? 6 : 4}" class="${isCur ? "pt-key" : "pt"}" ${tip(label)}/>`);
  }
  // 测试跑：菱形
  for (const t of tests) {
    const cx = x(Date.parse(t.activity.start)), cy = y(t.equivalentSec);
    parts.push(`<path d="M${cx} ${cy - 8} l8 8 l-8 8 l-8 -8 z" class="pt-test" ${tip(`测试跑 ${localDate(t.activity.start, tz)} · ${fmtDuration(t.equivalentSec)}`)}/>`);
  }

  // 只标两个点：当前水平和历史最好
  if (cur) {
    parts.push(`<text x="${x(Date.parse(cur.activity.start))}" y="${y(cur.equivalentSec) + 24}" class="t-small t-strong" text-anchor="middle">现在 ${fmtDuration(cur.equivalentSec)}</text>`);
  }
  const best = progress.bestEver;
  if (best && best !== cur && Date.parse(best.activity.start) >= startMs) {
    parts.push(`<text x="${x(Date.parse(best.activity.start))}" y="${y(best.equivalentSec) - 12}" class="t-small t-strong" text-anchor="middle">最好 ${fmtDuration(best.equivalentSec)}</text>`);
  }

  return `<svg viewBox="0 0 ${W} 340" class="chart" role="img" aria-label="成绩趋势">${parts.join("")}</svg>`;
}

// ---------- 3. 心率：最近 8 周每次跑步的平均心率，对照 2 区和 80% 线 ----------

export function heartRateChart(
  runs: Activity[],
  qualityIds: Set<string> | null,
  hrMax: number,
  now: Date,
  tz: string,
): string {
  const startMs = now.getTime() - 56 * DAY;
  const pts = runs.filter((a) => a.avgHr != null && Date.parse(a.start) >= startMs);
  if (pts.length === 0) return `<p class="empty">最近 8 周没有带心率的跑步。</p>`;
  const L = 64, R = W - 96, T = 16, B = 220;
  const x = scale(startMs, now.getTime(), L + 8, R - 8);
  const lo = 100, hi = Math.ceil(hrMax / 10) * 10;
  const y = scale(hi, lo, T, B);
  const z2a = Math.round(hrMax * 0.6), z2b = Math.round(hrMax * 0.7), lim = Math.round(hrMax * 0.8);
  const parts: string[] = [];

  for (let v = lo; v <= hi; v += 20) {
    parts.push(`<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`);
    parts.push(`<text x="${L - 10}" y="${y(v) + 4}" class="t-axis" text-anchor="end">${v}</text>`);
  }
  parts.push(`<rect x="${L}" y="${y(z2b)}" width="${R - L}" height="${y(z2a) - y(z2b)}" class="band"/>`);
  parts.push(`<text x="${R + 8}" y="${(y(z2a) + y(z2b)) / 2 + 4}" class="t-small t-quiet">2 区 ${z2a}–${z2b}</text>`);
  parts.push(`<line x1="${L}" x2="${R}" y1="${y(lim)}" y2="${y(lim)}" class="ref"/>`);
  parts.push(`<text x="${R + 8}" y="${y(lim) + 4}" class="t-small t-strong">80% · ${lim}</text>`);
  for (let w = 0; w <= 8; w += 2) {
    const t = now.getTime() - (8 - w) * 7 * DAY;
    parts.push(`<text x="${x(t)}" y="${B + 24}" class="t-axis" text-anchor="middle">${shortDate(localDate(new Date(t).toISOString(), tz))}</text>`);
  }

  for (const a of pts) {
    const hr = a.avgHr as number;
    const quality = qualityIds?.has(a.id) ?? false;
    const cls = quality ? "pt-hollow" : hr > lim ? "pt-key" : "pt";
    const kind = quality ? "质量课" : hr > lim ? "轻松跑，超过 80%" : "轻松跑";
    const label = `${localDate(a.start, tz)} · ${((a.distanceM ?? 0) / 1000).toFixed(2)} km · 配速 ${fmtPace(paceOf(a.durationSec, a.distanceM))} · 平均心率 ${Math.round(hr)} · ${kind}`;
    parts.push(`<circle cx="${x(Date.parse(a.start))}" cy="${y(hr)}" r="5" class="${cls}" ${tip(label)}/>`);
  }
  return `<svg viewBox="0 0 ${W} 260" class="chart" role="img" aria-label="最近 8 周的平均心率">${parts.join("")}</svg>`;
}

// ---------- 4. 周跑量：过去是实际，计划里的周是计划（当前周两者都画） ----------

export interface WeekBar {
  monday: string;
  actualKm: number | null;
  plannedKm: number | null;
}

export function weekBars(
  activities: Activity[],
  plan: PlannedSession[],
  today: string,
  tz: string,
  pastWeeks = 6,
): WeekBar[] {
  const thisMonday = mondayOf(today);
  const lastPlan = plan.at(-1)?.date;
  const end = lastPlan && lastPlan > today ? mondayOf(lastPlan) : thisMonday;
  const bars: WeekBar[] = [];
  for (let monday = addDays(thisMonday, -7 * pastWeeks); monday <= end; monday = addDays(monday, 7)) {
    const sunday = addDays(monday, 6);
    const inWeek = (d: string) => d >= monday && d <= sunday;
    const planned = plan.filter((s) => inWeek(s.date));
    const actual =
      monday <= thisMonday
        ? activities
            .filter((a) => a.sport === "running" && inWeek(localDate(a.start, tz)))
            .reduce((s, a) => s + (a.distanceM ?? 0) / 1000, 0)
        : null;
    bars.push({
      monday,
      actualKm: actual != null ? Math.round(actual * 10) / 10 : null,
      plannedKm: planned.length > 0 ? planned.reduce((s, p) => s + p.distanceKm, 0) : null,
    });
  }
  return bars;
}

export function volumeChart(bars: WeekBar[], today: string): string {
  const L = 64, R = W - 24, T = 24, B = 200;
  const max = Math.max(10, ...bars.map((b) => Math.max(b.actualKm ?? 0, b.plannedKm ?? 0)));
  const top = Math.ceil(max / 5) * 5;
  const y = scale(0, top, B, T);
  const band = (R - L) / bars.length;
  const bw = Math.min(24, band * 0.5);
  const parts: string[] = [];
  const thisMonday = mondayOf(today);

  for (let v = 0; v <= top; v += 5) {
    parts.push(`<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "axis" : "grid"}"/>`);
    parts.push(`<text x="${L - 10}" y="${y(v) + 4}" class="t-axis" text-anchor="end">${v}</text>`);
  }
  bars.forEach((b, i) => {
    const cx = L + band * i + band / 2;
    const bar = (km: number, cls: string, label: string) => {
      const h = B - y(km);
      if (h <= 0) return "";
      const r = Math.min(4, h);
      // 顶部 4px 圆角，底部方角
      return `<path d="M${cx - bw / 2} ${B} V${y(km) + r} q0 -${r} ${r} -${r} H${cx + bw / 2 - r} q${r} 0 ${r} ${r} V${B} z" class="${cls}" ${tip(label)}/>`;
    };
    const week = `${shortDate(b.monday)}–${shortDate(addDays(b.monday, 6))}`;
    if (b.plannedKm != null) parts.push(bar(b.plannedKm, "bar-plan", `${week} · 计划 ${b.plannedKm} km${b.actualKm != null ? ` · 已跑 ${b.actualKm} km` : ""}`));
    if (b.actualKm != null && b.actualKm > 0) parts.push(bar(b.actualKm, "bar-actual", `${week} · 实际 ${b.actualKm} km${b.plannedKm != null ? ` · 计划 ${b.plannedKm} km` : ""}`));
    const isNow = b.monday === thisMonday;
    parts.push(`<text x="${cx}" y="${B + 22}" class="t-axis${isNow ? " t-strong" : ""}" text-anchor="middle">${isNow ? "本周" : shortDate(b.monday)}</text>`);
  });
  return `<svg viewBox="0 0 ${W} 236" class="chart" role="img" aria-label="每周跑量">${parts.join("")}</svg>`;
}
