// 规则的输入和输出。
// 规则是纯函数：同样的输入一定得到同样的建议，所以每条规则都能写测试，也能解释。

import type { Activity } from "#schema";

export interface RuleContext {
  /** 所有运动记录，已按时间排序 */
  activities: Activity[];
  /** 最大心率（次/分） */
  hrMax: number;
  /** “现在”，测试时可以固定 */
  now: Date;
  /** 用户所在时区，例如 "Asia/Shanghai" */
  timeZone: string;
}

/** 一条建议依据的一次运动 */
export interface Evidence {
  activityId: string;
  date: string;
  distanceKm: number | null;
  pace: string;
  avgHr: number | null;
  /** 平均心率占最大心率的比例 */
  pctOfMax: number | null;
  /** 这一次是否命中规则 */
  flagged: boolean;
}

export interface Insight {
  ruleId: string;
  severity: "info" | "warning";
  title: string;
  /** 发现了什么（带数字） */
  finding: string;
  /** 建议怎么做 */
  suggestion: string;
  evidence: Evidence[];
  /** 这条建议依赖的假设，用户应能看到 */
  assumptions: string[];
  /** 关联的知识卡 ID */
  cardId: string | null;
}

export interface Rule {
  id: string;
  run(ctx: RuleContext): Insight | null;
}
