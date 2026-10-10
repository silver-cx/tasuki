// 成绩估算：把一次训练跑的成绩换算成目标距离的等效成绩。
//
// 用 Riegel 公式：T2 = T1 × (D2 / D1)^1.06
// 例如 10 km 用了 60 分钟，换算成 5 km 约 28:47。
//
// 注意：这里用的是训练中的跑步，大部分不是全力跑，所以估算值通常比真实能力慢。
// 我们取一段时间内“最好的一次”作为当时的水平，尽量接近真实能力。

import type { Activity } from "#schema";

export const RIEGEL_EXPONENT = 1.06;

/** 参与估算的跑步：距离 3–21.1 km，配速在 3:00–12:00/km 之间（排除走路和异常数据） */
export const ELIGIBLE = { minM: 3000, maxM: 21100, minPace: 180, maxPace: 720 };

export function riegel(timeSec: number, fromM: number, toM: number): number {
  return timeSec * Math.pow(toM / fromM, RIEGEL_EXPONENT);
}

export interface Effort {
  activity: Activity;
  /** 换算到目标距离的等效用时（秒） */
  equivalentSec: number;
}

/** 把每次合格的跑步换算成目标距离的等效成绩 */
export function efforts(activities: Activity[], targetM: number): Effort[] {
  const out: Effort[] = [];
  for (const a of activities) {
    if (a.sport !== "running" || a.distanceM == null) continue;
    if (a.distanceM < ELIGIBLE.minM || a.distanceM > ELIGIBLE.maxM) continue;
    const pace = a.durationSec / (a.distanceM / 1000);
    if (pace < ELIGIBLE.minPace || pace > ELIGIBLE.maxPace) continue;
    out.push({ activity: a, equivalentSec: riegel(a.durationSec, a.distanceM, targetM) });
  }
  return out;
}

/** 时间段 (fromMs, toMs] 内最好的一次 */
export function bestBetween(list: Effort[], fromMs: number, toMs: number): Effort | null {
  let best: Effort | null = null;
  for (const e of list) {
    const t = Date.parse(e.activity.start);
    if (t <= fromMs || t > toMs) continue;
    if (!best || e.equivalentSec < best.equivalentSec) best = e;
  }
  return best;
}
