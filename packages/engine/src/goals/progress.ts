// 目标进度与达成预测。
//
// 做法（每一步都可以解释给用户）：
//   1. 当前水平：最近 6 周内有测试跑时，用最近一次测试成绩；
//      否则用最近 4 周里换算成绩最好的一次训练跑。
//   2. 进步速度：有 2 次以上测试时，用最近两次测试之差 ÷ 间隔周数；
//      否则用“最近 4 周最好”与“之前 4 周最好”之差 ÷ 4（秒/周）。
//   3. 按这个速度线性外推，算出预计达成日，与截止日比较。
// 线性外推是简化：越接近能力上限进步越慢，所以预测偏乐观，越远越不准。

import type { Activity, RaceGoal } from "#schema";
import { bestBetween, efforts, type Effort } from "../metrics/performance.ts";

export type { Effort };

export const WINDOW_DAYS = 28;
/** 测试成绩在这么多天内都算“当前水平” */
export const TEST_VALID_DAYS = 42;
const DAY = 864e5;
const WEEK = 7 * DAY;

export type GoalStatus =
  | "achieved" // 当前水平已经达到目标
  | "on-track" // 按趋势能在截止日前达成
  | "behind" // 按趋势赶不上
  | "no-trend" // 有当前水平，但没有进步或缺少对比数据
  | "no-data" // 最近 4 周没有可用的跑步
  | "expired"; // 已过截止日

export interface GoalProgress {
  goal: RaceGoal;
  status: GoalStatus;
  /** 当前水平来自测试跑还是训练跑 */
  basis: "test" | "training";
  current: Effort | null;
  previous: Effort | null;
  /** 历史最好（全部记录） */
  bestEver: Effort | null;
  /** 每周进步多少秒（正数 = 变快） */
  ratePerWeek: number | null;
  /** 按期达成每周需要进步多少秒 */
  requiredPerWeek: number | null;
  /** 离目标还差多少秒（正数 = 还没达到） */
  gapSec: number | null;
  weeksLeft: number;
  /** 按当前趋势预计达成的时间（毫秒时间戳） */
  projectedMs: number | null;
  /** 按当前趋势，截止日那天大约能跑到的成绩 */
  projectedAtDeadlineSec: number | null;
}

/** 截止日当天结束的时间。按 UTC 计算，误差在一天以内，对“周”级别的预测没有影响。 */
export function deadlineMs(deadline: string): number {
  return Date.parse(`${deadline}T23:59:59Z`);
}

export function assessGoal(
  goal: RaceGoal,
  activities: Activity[],
  now: Date,
  tests: Effort[] = [],
): GoalProgress {
  const list = efforts(activities, goal.distanceM);
  const nowMs = now.getTime();
  const trainingCurrent = bestBetween(list, nowMs - WINDOW_DAYS * DAY, nowMs);
  const trainingPrevious = bestBetween(list, nowMs - 2 * WINDOW_DAYS * DAY, nowMs - WINDOW_DAYS * DAY);
  const bestEver = bestBetween([...list, ...tests], -Infinity, nowMs);
  const weeksLeft = (deadlineMs(goal.deadline) - nowMs) / WEEK;

  const pastTests = tests.filter((t) => Date.parse(t.activity.start) <= nowMs);
  const lastTest = pastTests.at(-1) ?? null;
  const useTest = lastTest != null && nowMs - Date.parse(lastTest.activity.start) <= TEST_VALID_DAYS * DAY;
  const current = useTest ? lastTest : trainingCurrent;
  const prevTest = useTest ? (pastTests.at(-2) ?? null) : null;
  const previous = prevTest ?? trainingPrevious;

  let rate: number | null = null;
  if (prevTest && lastTest) {
    const weeks = (Date.parse(lastTest.activity.start) - Date.parse(prevTest.activity.start)) / WEEK;
    rate = weeks > 0 ? (prevTest.equivalentSec - lastTest.equivalentSec) / weeks : null;
  } else if (trainingCurrent && trainingPrevious) {
    // 只有一次测试时，进步速度仍用训练跑的趋势（同一种方法前后比较才公平）
    rate = (trainingPrevious.equivalentSec - trainingCurrent.equivalentSec) / (WINDOW_DAYS / 7);
  }

  const base = {
    goal,
    basis: (useTest ? "test" : "training") as "test" | "training",
    current,
    previous,
    bestEver,
    weeksLeft,
    ratePerWeek: null,
    requiredPerWeek: null,
    gapSec: null,
    projectedMs: null,
    projectedAtDeadlineSec: null,
  };
  if (!current) return { ...base, status: "no-data" };

  const gapSec = current.equivalentSec - goal.targetSec;
  if (gapSec <= 0) return { ...base, gapSec, status: "achieved" };
  if (weeksLeft <= 0) return { ...base, gapSec, status: "expired" };

  const requiredPerWeek = gapSec / weeksLeft;
  const ratePerWeek = rate;
  if (ratePerWeek == null || ratePerWeek <= 0) {
    return { ...base, gapSec, requiredPerWeek, ratePerWeek, status: "no-trend" };
  }

  const projectedMs = nowMs + (gapSec / ratePerWeek) * WEEK;
  const projectedAtDeadlineSec = current.equivalentSec - ratePerWeek * weeksLeft;
  return {
    ...base,
    gapSec,
    requiredPerWeek,
    ratePerWeek,
    projectedMs,
    projectedAtDeadlineSec,
    status: projectedMs <= deadlineMs(goal.deadline) ? "on-track" : "behind",
  };
}
