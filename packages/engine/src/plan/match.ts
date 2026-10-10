// 把实际跑步对应到计划里的课。
//
// 规则：
//   - 优先匹配同一天的跑步。
//   - 轻松跑和长距离：同一天没有时，接受晚一天的跑步（前提是那天没有别的课）。
//     质量课和测试跑只认同一天，避免把一次普通跑步误当成测试，影响目标预测。
//   - 测试课：同一天有多次跑步时，选距离接近目标距离、换算成绩最好的那一次
//     （用户可能把热身、测试、放松分开记录）。
//   - 每次跑步只能对应一节课。

import type { Activity, PlannedSession, RaceGoal } from "#schema";
import { addDays, localDate } from "../format.ts";
import { riegel, type Effort } from "../metrics/performance.ts";

export type SessionStatus = "done" | "missed" | "today" | "upcoming";

export interface SessionMatch {
  session: PlannedSession;
  activity: Activity | null;
  status: SessionStatus;
}

export function matchPlan(
  sessions: PlannedSession[],
  activities: Activity[],
  goal: RaceGoal | null,
  today: string,
  timeZone: string,
): SessionMatch[] {
  const planned = new Set(sessions.map((s) => s.date));
  const runsByDate = new Map<string, Activity[]>();
  for (const a of activities) {
    if (a.sport !== "running") continue;
    const d = localDate(a.start, timeZone);
    runsByDate.set(d, [...(runsByDate.get(d) ?? []), a]);
  }
  const used = new Set<string>();

  const pick = (session: PlannedSession, candidates: Activity[]): Activity | null => {
    const free = candidates.filter((a) => !used.has(a.id));
    if (free.length === 0) return null;
    if (session.kind === "test" && goal) {
      const tests = free.filter((a) => (a.distanceM ?? 0) >= goal.distanceM * 0.95);
      if (tests.length === 0) return null;
      return tests.reduce((best, a) =>
        riegel(a.durationSec, a.distanceM as number, goal.distanceM) <
        riegel(best.durationSec, best.distanceM as number, goal.distanceM)
          ? a
          : best,
      );
    }
    // 其他课：取当天距离最长的一次
    return free.reduce((best, a) => ((a.distanceM ?? 0) > (best.distanceM ?? 0) ? a : best));
  };

  return [...sessions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((session) => {
      let activity = pick(session, runsByDate.get(session.date) ?? []);
      const next = addDays(session.date, 1);
      const flexible = session.kind === "easy" || session.kind === "long";
      if (!activity && flexible && !planned.has(next)) activity = pick(session, runsByDate.get(next) ?? []);
      if (activity) used.add(activity.id);
      const status: SessionStatus = activity
        ? "done"
        : session.date < today
          ? "missed"
          : session.date === today
            ? "today"
            : "upcoming";
      return { session, activity, status };
    });
}

/** 已完成的测试跑，换算成目标距离的成绩，按时间排序 */
export function testEfforts(matches: SessionMatch[], goal: RaceGoal): Effort[] {
  return matches
    .filter((m) => m.session.kind === "test" && m.activity?.distanceM)
    .map((m) => {
      const a = m.activity as Activity;
      return { activity: a, equivalentSec: riegel(a.durationSec, a.distanceM as number, goal.distanceM) };
    })
    .sort((a, b) => a.activity.start.localeCompare(b.activity.start));
}

/** 被计划识别为质量课（间歇、节奏、测试）的跑步 ID，轻松跑心率规则会排除它们 */
export function qualityActivityIds(matches: SessionMatch[]): Set<string> {
  return new Set(
    matches
      .filter((m) => m.activity && ["intervals", "tempo", "test"].includes(m.session.kind))
      .map((m) => (m.activity as Activity).id),
  );
}
