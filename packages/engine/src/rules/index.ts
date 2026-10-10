// 所有规则的清单。新增规则：在 rules/ 下加一个文件，写好测试，再加到这里。

import { easyRunHrTooHigh } from "./easyRunHrTooHigh.ts";
import type { Insight, Rule, RuleContext } from "./types.ts";

export const RULES: Rule[] = [easyRunHrTooHigh];

export function runRules(ctx: RuleContext, rules: Rule[] = RULES): Insight[] {
  return rules.map((r) => r.run(ctx)).filter((i): i is Insight => i != null);
}
