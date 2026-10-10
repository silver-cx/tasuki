// 规则：跑量增长过快。
//
// 触发条件：最近 7 天的跑量比之前 4 个“7 天”的平均值高出 30% 以上，
// 且之前的平均跑量不低于 5 km（刚开始跑或停训后恢复时不判断，避免误报）。

import { weeklyVolume } from "../metrics/volume.ts";
import type { Insight, Rule, RuleContext } from "./types.ts";

export const DEFAULTS = { rampPct: 0.3, minBaseKm: 5 };

export const volumeRamp: Rule = {
  id: "volume-ramp",
  run(ctx: RuleContext): Insight | null {
    const weeks = weeklyVolume(ctx.activities, ctx.now, 5);
    const last = weeks.at(-1);
    const before = weeks.slice(0, 4);
    if (!last) return null;
    const base = before.reduce((s, w) => s + w.km, 0) / before.length;
    if (base < DEFAULTS.minBaseKm) return null;
    if (last.km <= base * (1 + DEFAULTS.rampPct)) return null;

    const pct = Math.round((last.km / base - 1) * 100);
    const cap = Math.round(base * 1.1 * 10) / 10;
    return {
      ruleId: this.id,
      severity: "warning",
      title: "跑量增长过快",
      finding:
        `最近 7 天跑了 ${last.km} km（${last.runs} 次），比之前 4 周平均每周 ${Math.round(base * 10) / 10} km 高出 ${pct}%。`,
      suggestion:
        `接下来一周把跑量控制在 ${cap} km 左右，给身体时间适应。跑量涨得太快是跑步受伤最常见的原因之一。`,
      evidence: [],
      assumptions: ["跑量按“截至今天的连续 7 天”统计；只统计跑步，不含骑行和网球等其他运动。"],
      cardId: "mileage-increase",
    };
  },
};
