// 目标进度与达成预测。
//
// 做法（每一步都可以解释给用户）：
//   1. 当前水平 = 最近 4 周里换算成绩最好的一次
//   2. 4 周前水平 = 再往前 4 周里最好的一次
//   3. 进步速度 = 两者之差 ÷ 4（秒/周）
//   4. 按这个速度线性外推，算出预计达成日，与截止日比较
// 线性外推是简化：越接近能力上限进步越慢，所以预测偏乐观，越远越不准。

import type { Activity, RaceGoal } from "#schema";
import { bestBetween, efforts, type Effort } from "../metrics/performance.ts";

export const WINDOW_DAYS = 28;
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

export function assessGoal(goal: RaceGoal, activities: Activity[], now: Date): GoalProgress {
  const list = efforts(activities, goal.distanceM);
  const nowMs = now.getTime();
  const current = bestBetween(list, nowMs - WINDOW_DAYS * DAY, nowMs);
  const previous = bestBetween(list, nowMs - 2 * WINDOW_DAYS * DAY, nowMs - WINDOW_DAYS * DAY);
  const bestEver = bestBetween(list, -Infinity, nowMs);
  const weeksLeft = (deadlineMs(goal.deadline) - nowMs) / WEEK;

  const base = {
    goal,
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
  const ratePerWeek = previous
    ? (previous.equivalentSec - current.equivalentSec) / (WINDOW_DAYS / 7)
    : null;
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
