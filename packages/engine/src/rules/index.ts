// 所有规则的清单。新增规则：在 rules/ 下加一个文件，写好测试，再加到这里。

import { easyRunHrTooHigh } from "./easyRunHrTooHigh.ts";
import { goalOffTrack } from "./goalOffTrack.ts";
import { volumeRamp } from "./volumeRamp.ts";
import type { Insight, Rule, RuleContext } from "./types.ts";

// 顺序即报告里的显示顺序：先目标，再强度，再跑量
export const RULES: Rule[] = [goalOffTrack, easyRunHrTooHigh, volumeRamp];

export function runRules(ctx: RuleContext, rules: Rule[] = RULES): Insight[] {
  return rules.map((r) => r.run(ctx)).filter((i): i is Insight => i != null);
}
