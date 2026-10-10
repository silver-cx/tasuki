// 训练报告：心率区间、最近的跑步、教练建议。数据从本地数据库读取。

import type { Activity, DailyMetrics, RaceGoal } from "#schema";
import { distanceName, fmtDuration, fmtPace, localDate, paceOf, shortDate } from "#engine/format.ts";
import { assessGoal, type GoalStatus } from "#engine/goals/progress.ts";
import { weeklyVolume } from "#engine/metrics/volume.ts";
import { ZONES, estimateHrMax, zoneOf, zoneRange } from "#engine/metrics/hrZones.ts";
import { runRules } from "#engine/rules/index.ts";
import { loadCard } from "#knowledge";
import type { SyncInfo } from "#store";

export interface ReportInput {
  activities: Activity[];
  daily: DailyMetrics;
  syncLog: SyncInfo[];
  days: number;
  now: Date;
  timeZone: string;
  hrmax: number | null;
  goal: RaceGoal | null;
}

const STATUS_TEXT: Record<GoalStatus, string> = {
  achieved: "已达成",
  "on-track": "进度正常",
  behind: "进度落后",
  "no-trend": "暂时无法预测",
  "no-data": "最近 4 周没有可用的跑步",
  expired: "已过截止日",
};

const SOURCE_NAMES: Record<string, string> = {
  metricbridge: "MetricBridge",
  "apple-export": "健康 App 导出包",
};

function line(text = "") {
  console.log(text);
}

/** 按显示宽度补空格（中文字符算两个宽度），保证表格对齐 */
function pad(text: string, width: number) {
  const w = [...text].reduce((n, ch) => n + (/[　-￿]/.test(ch) ? 2 : 1), 0);
  return text + " ".repeat(Math.max(0, width - w));
}

function latest(byDate: Record<string, number> | undefined): number | null {
  if (!byDate) return null;
  const last = Object.keys(byDate).sort().at(-1);
  return last ? byDate[last] : null;
}

function printGoal(input: ReportInput) {
  const { goal, now, timeZone } = input;
  if (!goal) {
    line("目标：还没有设置。例如：npm run goal -- set --distance 5 --time 30:00 --by 2026-11-30");
    line();
    return;
  }
  const p = assessGoal(goal, input.activities, now);
  const day = (iso: string) => shortDate(localDate(iso, timeZone));
  const weeks = p.weeksLeft > 0 ? `，还剩 ${p.weeksLeft.toFixed(1)} 周` : "";
  line(
    `目标：${distanceName(goal.distanceM)} 跑进 ${fmtDuration(goal.targetSec)}` +
      `（截止 ${shortDate(goal.deadline)}${weeks}）· ${STATUS_TEXT[p.status]}`,
  );
  if (p.current) {
    const a = p.current.activity;
    const km = a.distanceM ? `${(a.distanceM / 1000).toFixed(2)} km` : "";
    const gap = p.gapSec != null && p.gapSec > 0 ? ` · 还差 ${fmtDuration(p.gapSec)}` : "";
    line(`  当前水平：折合 ${fmtDuration(p.current.equivalentSec)}（${day(a.start)} 那次 ${km}）${gap}`);
  }
  if (p.bestEver && p.bestEver !== p.current) {
    line(
      `  历史最好：折合 ${fmtDuration(p.bestEver.equivalentSec)}` +
        `（${localDate(p.bestEver.activity.start, timeZone)}）`,
    );
  }
  if (p.ratePerWeek != null && p.requiredPerWeek != null) {
    const rate =
      p.ratePerWeek > 0 ? `每周快约 ${Math.round(p.ratePerWeek)} 秒` : "最近 4 周没有比之前更快";
    line(`  进步速度：${rate}；按期达成需要每周快约 ${Math.round(p.requiredPerWeek)} 秒`);
  }
  if (p.projectedMs != null) {
    line(`  预测：按当前趋势，${day(new Date(p.projectedMs).toISOString())} 前后达成`);
  }
  line();
}

function printVolume(input: ReportInput) {
  const weeks = weeklyVolume(input.activities, input.now, 6);
  line("最近 6 周跑量（每 7 天）");
  for (const w of weeks) {
    const end = shortDate(localDate(new Date(w.endMs).toISOString(), input.timeZone));
    const bar = "█".repeat(Math.round(w.km / 2));
    line(`  截至 ${pad(end, 6)}${pad(`${w.km.toFixed(1)} km`, 10)}${pad(`${w.runs} 次`, 6)}${bar}`);
  }
  line();
}

export function printReport(input: ReportInput) {
  const { activities, now, timeZone, days } = input;
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString("zh-CN", { timeZone, hour12: false });

  line("Tasuki · 训练报告");
  for (const s of input.syncLog) {
    const when = s.exportedAt ? `数据截至 ${fmtTime(s.exportedAt)}` : `导入于 ${fmtTime(s.syncedAt)}`;
    line(`  ${SOURCE_NAMES[s.source] ?? s.source}：${when}`);
  }
  line();

  printGoal(input);

  const runs = activities.filter((a) => a.sport === "running");
  if (runs.length === 0) {
    line("还没有跑步记录。");
    return;
  }
  const withHr = runs.filter((a) => a.avgHr != null);
  const totalKm = runs.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000;
  line(
    `跑步记录：${runs.length} 次，共 ${totalKm.toFixed(1)} km，` +
      `最早 ${localDate(runs[0].start, timeZone)}；其中 ${withHr.length} 次带心率。`,
  );

  const hrMax = estimateHrMax({
    age: latest(input.daily.age),
    activities: runs,
    manual: input.hrmax,
  });
  if (!hrMax) {
    line("没有年龄，也没有心率数据，暂时无法划分心率区间。可以用 --hrmax 手动指定最大心率。");
    return;
  }
  const how =
    hrMax.method === "manual"
      ? "手动指定"
      : hrMax.method === "age"
        ? `按 220 − 年龄 ${hrMax.age} 估算`
        : "取实测最高心率";
  const observed = hrMax.observedMax != null ? `；实测最高 ${Math.round(hrMax.observedMax)}` : "";
  line(`最大心率：${hrMax.value}（${how}${observed}）`);
  line(
    "心率区间：" +
      ZONES.map((z) => {
        const [lo, hi] = zoneRange(z, hrMax.value);
        return z.zone === 1 ? `1 区 <${hi}` : z.zone === 5 ? `5 区 ≥${lo}` : `${z.zone} 区 ${lo}–${hi}`;
      }).join(" · "),
  );
  line();

  // 最近 N 天的跑步明细
  const since = now.getTime() - days * 864e5;
  const recent = runs.filter(
    (a) => Date.parse(a.start) >= since && Date.parse(a.start) <= now.getTime(),
  );
  line(`最近 ${days} 天的跑步（按平均心率归入区间）`);
  if (recent.length === 0) {
    line("  这段时间没有跑步。");
  } else {
    line(`  ${pad("日期", 7)}${pad("距离", 10)}${pad("配速", 7)}${pad("平均心率", 10)}区间`);
    const counts = new Map<number, number>();
    for (const a of recent) {
      const date = shortDate(localDate(a.start, timeZone));
      const km = a.distanceM ? `${(a.distanceM / 1000).toFixed(2)} km` : "—";
      const pace = fmtPace(paceOf(a.durationSec, a.distanceM));
      let hr = "—";
      let zone = "无心率数据";
      if (a.avgHr != null) {
        const z = zoneOf(a.avgHr, hrMax.value);
        counts.set(z.zone, (counts.get(z.zone) ?? 0) + 1);
        hr = String(Math.round(a.avgHr));
        zone = `${z.zone} 区 ${z.name}（${Math.floor((a.avgHr / hrMax.value) * 100)}%）`;
      }
      line(`  ${pad(date, 7)}${pad(km, 10)}${pad(pace, 7)}${pad(hr, 10)}${zone}`);
    }
    if (counts.size > 0) {
      line("  分布：" + ZONES.map((z) => `${z.zone} 区 ${counts.get(z.zone) ?? 0} 次`).join(" · "));
    }
  }
  line();

  printVolume(input);

  // 教练建议
  const insights = runRules({ activities, hrMax: hrMax.value, now, timeZone, goal: input.goal });
  line("建议");
  if (insights.length === 0) line("  目前没有需要调整的地方，继续保持。");
  for (const ins of insights) {
    line(`  ${ins.severity === "warning" ? "⚠" : "·"} ${ins.title}`);
    line(`    发现：${ins.finding}`);
    line(`    建议：${ins.suggestion}`);
    const flagged = ins.evidence.filter((e) => e.flagged);
    if (flagged.length > 0) {
      line(
        "    依据：" +
          flagged
            .map(
              (e) =>
                `${shortDate(e.date)} 心率 ${e.avgHr}（${Math.floor((e.pctOfMax ?? 0) * 100)}%）`,
            )
            .join("，"),
      );
    }
    for (const a of ins.assumptions) line(`    假设：${a}`);
    if (ins.cardId) {
      const card = loadCard(ins.cardId);
      if (card) {
        const status = card.status === "reviewed" ? "" : "（草稿，待审核）";
        line(`    知识卡：《${card.title}》${status}`);
      }
    }
    line();
  }
}
