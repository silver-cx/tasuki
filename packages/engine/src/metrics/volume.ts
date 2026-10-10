// 跑量：按“截至今天的连续 7 天”分组统计，不受周一还是周日开始的影响。

import type { Activity } from "#schema";

export interface WeekVolume {
  /** 这 7 天的最后一天（毫秒时间戳） */
  endMs: number;
  km: number;
  runs: number;
}

/** 最近 weeks 个 7 天的跑量，从早到晚排列；最后一项是截至 now 的 7 天 */
export function weeklyVolume(activities: Activity[], now: Date, weeks = 8): WeekVolume[] {
  const DAY = 864e5;
  const out: WeekVolume[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const endMs = now.getTime() - i * 7 * DAY;
    const startMs = endMs - 7 * DAY;
    let km = 0;
    let runs = 0;
    for (const a of activities) {
      if (a.sport !== "running") continue;
      const t = Date.parse(a.start);
      if (t > startMs && t <= endMs) {
        km += (a.distanceM ?? 0) / 1000;
        runs++;
      }
    }
    out.push({ endMs, km: Math.round(km * 10) / 10, runs });
  }
  return out;
}
