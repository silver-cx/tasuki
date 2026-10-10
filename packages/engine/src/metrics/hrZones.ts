// 心率区间。
// 一期按“最大心率百分比”划 5 个区。最大心率取两者中较大的一个：
//   1. 220 − 年龄（粗略公式，个体差异大）
//   2. 实测到的最高心率（只会比真实最大心率低或相等）
// 用户可以手动指定最大心率覆盖估算（例如做过最大心率测试）。

import type { Activity } from "#schema";

export interface Zone {
  zone: 1 | 2 | 3 | 4 | 5;
  name: string;
  /** 下限，占最大心率的比例 */
  lo: number;
  /** 上限（不含），占最大心率的比例 */
  hi: number;
}

export const ZONES: Zone[] = [
  { zone: 1, name: "恢复", lo: 0, hi: 0.6 },
  { zone: 2, name: "轻松有氧", lo: 0.6, hi: 0.7 },
  { zone: 3, name: "有氧耐力", lo: 0.7, hi: 0.8 },
  { zone: 4, name: "乳酸阈", lo: 0.8, hi: 0.9 },
  { zone: 5, name: "最大摄氧", lo: 0.9, hi: Infinity },
];

export type HrMaxMethod = "manual" | "age" | "observed";

export interface HrMaxEstimate {
  value: number;
  method: HrMaxMethod;
  age: number | null;
  observedMax: number | null;
}

export function observedMaxHr(activities: Activity[]): number | null {
  let max: number | null = null;
  for (const a of activities) {
    if (a.maxHr != null && (max == null || a.maxHr > max)) max = a.maxHr;
  }
  return max;
}

export function estimateHrMax(opts: {
  age: number | null;
  activities: Activity[];
  manual?: number | null;
}): HrMaxEstimate | null {
  const observedMax = observedMaxHr(opts.activities);
  const age = opts.age;
  if (opts.manual) return { value: opts.manual, method: "manual", age, observedMax };
  const byAge = age != null ? 220 - age : null;
  if (byAge == null && observedMax == null) return null;
  if (observedMax != null && (byAge == null || observedMax > byAge)) {
    return { value: Math.round(observedMax), method: "observed", age, observedMax };
  }
  return { value: byAge as number, method: "age", age, observedMax };
}

export function zoneOf(hr: number, hrMax: number): Zone {
  const pct = hr / hrMax;
  return ZONES.find((z) => pct >= z.lo && pct < z.hi) ?? ZONES[0];
}

/** 区间的心率范围，例如 2 区 → [113, 132] */
export function zoneRange(zone: Zone, hrMax: number): [number, number] {
  return [Math.round(zone.lo * hrMax), Math.round(Math.min(zone.hi, 1) * hrMax)];
}
