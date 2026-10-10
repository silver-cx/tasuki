// 规则：目标进度落后。
//
// 触发条件：设置了成绩目标，并且
//   - 按最近 4 周的进步速度，预计达成日晚于截止日；或
//   - 最近 4 周比之前 4 周没有进步（或缺少对比数据），无法预测。

import { assessGoal, deadlineMs } from "../goals/progress.ts";
import { distanceName, fmtDuration, localDate, shortDate } from "../format.ts";
import type { Insight, Rule, RuleContext } from "./types.ts";

export const goalOffTrack: Rule = {
  id: "goal-off-track",
  run(ctx: RuleContext): Insight | null {
    if (!ctx.goal) return null;
    const p = assessGoal(ctx.goal, ctx.activities, ctx.now, ctx.tests ?? []);
    if (p.status !== "behind" && p.status !== "no-trend") return null;
    if (!p.current || p.requiredPerWeek == null) return null;

    const name = distanceName(ctx.goal.distanceM);
    const target = fmtDuration(ctx.goal.targetSec);
    const deadline = shortDate(ctx.goal.deadline);
    const req = Math.round(p.requiredPerWeek);
    const day = (ms: number) => shortDate(localDate(new Date(ms).toISOString(), ctx.timeZone));

    const runDay = (iso: string) => shortDate(localDate(iso, ctx.timeZone));
    const basis =
      p.basis === "test"
        ? `${runDay(p.current.activity.start)} 的测试跑成绩折合 ${name} ${fmtDuration(p.current.equivalentSec)}` +
          (p.previous ? `；上一次参考成绩是 ${runDay(p.previous.activity.start)} 的 ${fmtDuration(p.previous.equivalentSec)}。` : "。")
        : `最近 4 周最好的一次是 ${runDay(p.current.activity.start)}，折合 ${name} ${fmtDuration(p.current.equivalentSec)}` +
          (p.previous
            ? `；之前 4 周最好的是 ${runDay(p.previous.activity.start)}，折合 ${fmtDuration(p.previous.equivalentSec)}。`
            : "。");
    let finding: string;
    let adjust: string;
    if (p.status === "behind" && p.ratePerWeek != null && p.projectedMs != null) {
      const lateWeeks = Math.max(1, Math.round((p.projectedMs - deadlineMs(ctx.goal.deadline)) / (7 * 864e5)));
      finding =
        basis +
        `按这个进步速度（约 ${Math.round(p.ratePerWeek)} 秒/周），预计 ${day(p.projectedMs)} 前后跑进 ${target}，` +
        `比截止日 ${deadline} 晚约 ${lateWeeks} 周。按期达成需要每周快约 ${req} 秒。`;
      adjust =
        `按当前趋势，截止日大约能跑到 ${fmtDuration(p.projectedAtDeadlineSec)}；` +
        `可以把这一期目标定为它，或把截止日推迟到 ${day(p.projectedMs)} 前后。`;
    } else {
      finding =
        basis +
        (p.previous ? "最近 4 周没有比之前更快" : "之前 4 周没有可对比的跑步") +
        `，暂时无法预测达成日。按期达成需要每周快约 ${req} 秒。`;
      adjust = "先按第 ① 条连续练 3–4 周，再看趋势决定要不要调整目标。";
    }

    if (p.bestEver && p.bestEver.equivalentSec <= ctx.goal.targetSec) {
      const when = localDate(p.bestEver.activity.start, ctx.timeZone);
      finding += `你在 ${when} 跑出过折合 ${fmtDuration(p.bestEver.equivalentSec)} 的成绩，这个目标在你的能力范围内。`;
    }

    return {
      ruleId: this.id,
      severity: "warning",
      title: `${name} 目标进度落后`,
      finding,
      suggestion:
        (ctx.qualityActivityIds
          ? "两个选择：① 保持目标：按训练计划执行（npm run plan），重点完成每周的质量课和测试跑，轻松跑守住心率上限。"
          : "两个选择：① 保持目标：每周安排 1 次间歇跑或节奏跑专门提速，其余跑步放慢到轻松强度，" +
            "每周跑量增幅不超过约 10%；运行 npm run plan 可以生成具体计划。") +
        `② 调整目标：${adjust}`,
      evidence: [],
      assumptions: [
        p.basis === "test"
          ? "当前水平来自计划里最近一次测试跑（全力跑），比训练跑估算更可靠。"
          : "当前水平取最近 4 周换算成绩最好的一次（Riegel 公式）。训练跑大多不是全力跑，测试跑之后会更准。",
        "进步速度线性外推；样本少时波动大，越接近能力上限进步越慢。",
      ],
      cardId: "improve-5k",
    };
  },
};
