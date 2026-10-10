// 命令行输出的小工具，以及报告和计划共用的“一周课表”打印。

import { WEEKDAY_NAMES, addDays, fmtPace, isoWeekday, mondayOf, paceOf, shortDate } from "#engine/format.ts";
import type { SessionMatch } from "#engine/plan/match.ts";
import type { Context } from "./context.ts";

export function line(text = "") {
  console.log(text);
}

/** 按显示宽度补空格（中文字符算两个宽度），保证表格对齐 */
export function pad(text: string, width: number) {
  const w = [...text].reduce((n, ch) => n + (/[　-￿]/.test(ch) ? 2 : 1), 0);
  return text + " ".repeat(Math.max(0, width - w));
}

const STATUS_MARK: Record<SessionMatch["status"], string> = {
  done: "✓",
  missed: "✗",
  today: "▶",
  upcoming: "·",
};

function actual(m: SessionMatch): string {
  const a = m.activity;
  if (!a) return m.status === "missed" ? "未完成" : m.status === "today" ? "今天" : "";
  const km = a.distanceM ? `${(a.distanceM / 1000).toFixed(2)} km` : "";
  const pace = fmtPace(paceOf(a.durationSec, a.distanceM));
  const hr = a.avgHr != null ? ` 心率 ${Math.round(a.avgHr)}` : "";
  const over = m.session.hrCap != null && a.avgHr != null && a.avgHr > m.session.hrCap ? "（超过上限）" : "";
  return `实际 ${km} ${pace}/km${hr}${over}`;
}

/** 打印 day 所在那一周（周一到周日）的课表 */
export function printWeek(ctx: Context, day: string, heading: string) {
  const monday = mondayOf(day);
  const sunday = addDays(monday, 6);
  const week = ctx.matches.filter((m) => m.session.date >= monday && m.session.date <= sunday);
  const plannedKm = week.reduce((s, m) => s + m.session.distanceKm, 0);
  const done = week.filter((m) => m.status === "done").length;
  line(`${heading}（${shortDate(monday)}–${shortDate(sunday)}）· 计划 ${plannedKm} km · 已完成 ${done}/${week.length}`);
  if (week.length === 0) line("  这周没有安排。");
  for (const m of week) {
    const d = m.session.date;
    line(
      `  ${STATUS_MARK[m.status]} ${pad(`${WEEKDAY_NAMES[isoWeekday(d)]} ${shortDate(d)}`, 12)}` +
        `${pad(m.session.title, 34)}${actual(m)}`,
    );
  }
}
