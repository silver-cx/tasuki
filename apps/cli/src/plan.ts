// npm run plan：按目标生成（或查看）训练计划。

import { WEEKDAY_NAMES, addDays, distanceName, fmtDuration, isoWeekday, mondayOf, shortDate } from "#engine/format.ts";
import { assessGoal } from "#engine/goals/progress.ts";
import { ZONES, zoneRange } from "#engine/metrics/hrZones.ts";
import { weeklyVolume } from "#engine/metrics/volume.ts";
import { generatePlan, TEST_EVERY } from "#engine/plan/generate.ts";
import { getSetting, savePlan, setSetting, type Store } from "#store";
import type { Context } from "./context.ts";
import { line, printWeek } from "./print.ts";

export const DEFAULT_WEEKDAYS = "2,4,6";

export function parseWeekdays(text: string): number[] | null {
  const days = text.split(/[,，\s]+/).filter(Boolean).map(Number);
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return null;
  return [...new Set(days)].sort();
}

export function weekdaysOf(db: Store): number[] {
  return parseWeekdays(getSetting(db, "plan_weekdays") ?? DEFAULT_WEEKDAYS) as number[];
}

export function setWeekdays(db: Store, days: number[]) {
  setSetting(db, "plan_weekdays", days.join(","));
}

/** 从明天开始重新生成计划（过去和今天的课保留）。返回生成的课数。 */
export function regeneratePlan(db: Store, ctx: Context): number {
  const goal = ctx.goal;
  if (!goal) return 0;
  const progress = assessGoal(goal, ctx.activities, ctx.now, ctx.tests);
  const recentWeeksKm = weeklyVolume(ctx.activities, ctx.now, 4).map((w) => w.km);
  const startDate = addDays(ctx.today, 1);
  const sessions = generatePlan({
    goal,
    currentSec: progress.current?.equivalentSec ?? null,
    recentWeeksKm,
    easyHrCap: ctx.hrMax ? zoneRange(ZONES[1], ctx.hrMax.value)[1] : null,
    weekdays: weekdaysOf(db),
    startDate,
  });
  savePlan(db, sessions, startDate, goal.id);
  return sessions.length;
}

export function printPlan(db: Store, ctx: Context) {
  const goal = ctx.goal;
  if (!goal) return;
  const days = weekdaysOf(db).map((d) => WEEKDAY_NAMES[d]).join("、");
  line(`训练计划：${goal.deadline} 前 ${distanceName(goal.distanceM)} 跑进 ${fmtDuration(goal.targetSec)}`);
  line(`  每周 ${weekdaysOf(db).length} 次（${days}）· 每 ${TEST_EVERY} 周一次全力测试，最后一次就是冲击目标`);
  line(`  ✓ 完成  ✗ 未完成  ▶ 今天  · 待完成`);
  line();

  let week = 1;
  for (let monday = mondayOf(ctx.today); monday <= goal.deadline; monday = addDays(monday, 7)) {
    const hasSessions = ctx.matches.some((m) => m.session.date >= monday && m.session.date <= addDays(monday, 6));
    if (!hasSessions) continue;
    const isTest = ctx.matches.some(
      (m) => m.session.kind === "test" && m.session.date >= monday && m.session.date <= addDays(monday, 6),
    );
    printWeek(ctx, monday, `第 ${week} 周${isTest ? " · 测试周" : ""}`);
    line();
    week++;
  }

  const soon = ctx.matches.filter(
    (m) => (m.status === "today" || m.status === "upcoming") && m.session.date <= addDays(ctx.today, 7),
  );
  if (soon.length > 0) {
    line("接下来 7 天怎么跑");
    for (const m of soon) {
      line(`  ${WEEKDAY_NAMES[isoWeekday(m.session.date)]} ${shortDate(m.session.date)}  ${m.session.title}`);
      line(`    ${m.session.detail}`);
    }
    line();
  }
  line("计划会根据测试成绩更新：每次测试后运行 npm run plan，后面的配速和跑量会自动调整。");
}
