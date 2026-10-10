// 规则：轻松跑心率过高。
//
// 触发条件（阈值可调，见 DEFAULTS）：
//   最近 14 天带心率的跑步里，最近一次的平均心率超过最大心率的 80%，
//   或者至少一半（且至少 2 次）超过 80%。
//
// 有训练计划时，计划里的间歇跑、节奏跑和测试跑会被排除；
// 没有计划时无法区分，暂时把所有跑步都当作轻松跑。

import { fmtPace, localDate, paceOf } from "../format.ts";
import { ZONES, zoneRange } from "../metrics/hrZones.ts";
import type { Evidence, Insight, Rule, RuleContext } from "./types.ts";

export const DEFAULTS = {
  windowDays: 14,
  /** 平均心率超过最大心率的这个比例，就不算轻松跑 */
  limitPct: 0.8,
  /** 至少这么多次带心率的跑步才判断“多数” */
  minRuns: 2,
};

export const easyRunHrTooHigh: Rule = {
  id: "easy-run-hr-too-high",
  run(ctx: RuleContext): Insight | null {
    const since = ctx.now.getTime() - DEFAULTS.windowDays * 864e5;
    const runs = ctx.activities.filter(
      (a) =>
        a.sport === "running" &&
        !ctx.qualityActivityIds?.has(a.id) &&
        a.avgHr != null &&
        Date.parse(a.start) >= since &&
        Date.parse(a.start) <= ctx.now.getTime(),
    );
    if (runs.length === 0) return null;

    const limit = ctx.hrMax * DEFAULTS.limitPct;
    const evidence: Evidence[] = runs.map((a) => ({
      activityId: a.id,
      date: localDate(a.start, ctx.timeZone),
      distanceKm: a.distanceM != null ? Math.round(a.distanceM / 10) / 100 : null,
      pace: fmtPace(paceOf(a.durationSec, a.distanceM)),
      avgHr: a.avgHr != null ? Math.round(a.avgHr) : null,
      pctOfMax: a.avgHr != null ? a.avgHr / ctx.hrMax : null,
      flagged: (a.avgHr as number) > limit,
    }));

    const flagged = evidence.filter((e) => e.flagged).length;
    const latestFlagged = evidence.at(-1)?.flagged ?? false;
    const mostFlagged = runs.length >= DEFAULTS.minRuns && flagged * 2 >= runs.length;
    if (!latestFlagged && !mostFlagged) return null;

    const [, z2Top] = zoneRange(ZONES[1], ctx.hrMax);
    return {
      ruleId: this.id,
      severity: "warning",
      title: "轻松跑心率偏高",
      finding:
        `最近 ${DEFAULTS.windowDays} 天 ${runs.length} 次带心率的跑步里，` +
        `${flagged} 次平均心率超过最大心率的 ${Math.round(DEFAULTS.limitPct * 100)}%（约 ${Math.round(limit)}）。` +
        "这样的强度已经不是轻松跑。",
      suggestion:
        `下一次轻松跑把心率上限设在 ${z2Top} 左右（2 区上限）。超过就放慢，必要时走一段，等心率回落再跑。` +
        "前几周配速会明显变慢，这是正常的；坚持下来，同样心率下的配速通常会变快。",
      evidence,
      assumptions: [
        ctx.qualityActivityIds
          ? "计划里的间歇跑、节奏跑和测试跑已排除，只看其余跑步。"
          : "还没有训练计划，暂把所有跑步都当作轻松跑；间歇跑和节奏跑本来就该在高心率区间。",
        "心率区间按最大心率百分比估算，最大心率可以手动校准。",
      ],
      cardId: "easy-run-slow",
    };
  },
};
