// 汇总一次报告或计划需要的全部数据：运动记录、目标、计划及其完成情况、测试成绩、最大心率。

import type { Activity, DailyMetrics, PlannedSession, RaceGoal } from "#schema";
import { localDate } from "#engine/format.ts";
import { estimateHrMax, type HrMaxEstimate } from "#engine/metrics/hrZones.ts";
import type { Effort } from "#engine/metrics/performance.ts";
import { matchPlan, qualityActivityIds, testEfforts, type SessionMatch } from "#engine/plan/match.ts";
import {
  loadActivities,
  loadDaily,
  loadPlan,
  loadRaceGoal,
  loadSyncLog,
  type Store,
  type SyncInfo,
} from "#store";

export interface Context {
  now: Date;
  today: string;
  timeZone: string;
  activities: Activity[];
  daily: DailyMetrics;
  syncLog: SyncInfo[];
  goal: RaceGoal | null;
  plan: PlannedSession[];
  matches: SessionMatch[];
  tests: Effort[];
  qualityIds: Set<string> | null;
  hrMax: HrMaxEstimate | null;
}

function latest(byDate: Record<string, number> | undefined): number | null {
  if (!byDate) return null;
  const last = Object.keys(byDate).sort().at(-1);
  return last ? byDate[last] : null;
}

export function buildContext(
  db: Store,
  opts: { now: Date; timeZone: string; hrmax: number | null },
): Context {
  const activities = loadActivities(db);
  const daily = loadDaily(db);
  const goal = loadRaceGoal(db);
  const plan = loadPlan(db);
  const today = localDate(opts.now.toISOString(), opts.timeZone);
  const matches = matchPlan(plan, activities, goal, today, opts.timeZone);
  return {
    now: opts.now,
    today,
    timeZone: opts.timeZone,
    activities,
    daily,
    syncLog: loadSyncLog(db),
    goal,
    plan,
    matches,
    tests: goal ? testEfforts(matches, goal) : [],
    qualityIds: plan.length > 0 ? qualityActivityIds(matches) : null,
    hrMax: estimateHrMax({
      age: latest(daily.age),
      activities: activities.filter((a) => a.sport === "running"),
      manual: opts.hrmax,
    }),
  };
}
