// Tasuki 命令行：读取健康数据，输出心率分析和训练建议。
//
// 用法：
//   npm run report
//   npm run report -- --days 28 --hrmax 186
//
// 参数：
//   --data <文件夹>   MetricBridge 数据文件夹（默认是 iCloud 里的 MetricBridge 目录）
//   --days <天数>     报告覆盖最近多少天（默认 14）
//   --hrmax <心率>    手动指定最大心率，覆盖估算
//   --tz <时区>       默认 Asia/Shanghai
//   --now <日期>      把“今天”当作某一天，用于回看过去或演示样例数据，例如 2026-10-01

import { parseArgs } from "node:util";
import { DEFAULT_DIR, MetricBridgeError, latestDaily, loadMetricBridge } from "#adapters/metricbridge";
import { fmtPace, localDate, paceOf, shortDate } from "#engine/format.ts";
import { ZONES, estimateHrMax, zoneOf, zoneRange } from "#engine/metrics/hrZones.ts";
import { runRules } from "#engine/rules/index.ts";
import { loadCard } from "#knowledge";

const { values } = parseArgs({
  options: {
    data: { type: "string", default: DEFAULT_DIR },
    days: { type: "string", default: "14" },
    hrmax: { type: "string" },
    tz: { type: "string", default: "Asia/Shanghai" },
    now: { type: "string" },
  },
});

const timeZone = values.tz as string;
const days = Number(values.days);
const now = values.now ? new Date(`${values.now}T23:59:59+08:00`) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error("--now 的格式应为 YYYY-MM-DD，例如 2026-10-01");
  process.exit(1);
}

function line(text = "") {
  console.log(text);
}

function pad(text: string, width: number) {
  // 中文字符按两个宽度计算，保证表格对齐
  const w = [...text].reduce((n, ch) => n + (/[　-￿]/.test(ch) ? 2 : 1), 0);
  return text + " ".repeat(Math.max(0, width - w));
}

let snapshot;
try {
  snapshot = loadMetricBridge(values.data);
} catch (err) {
  if (err instanceof MetricBridgeError) {
    console.error(`读取数据失败：${err.message}`);
    process.exit(1);
  }
  throw err;
}

const runs = snapshot.activities.filter((a) => a.sport === "running");
const runsWithHr = runs.filter((a) => a.avgHr != null);
const totalKm = runs.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000;
const age = latestDaily(snapshot, "age");
const hrMax = estimateHrMax({
  age,
  activities: runs,
  manual: values.hrmax ? Number(values.hrmax) : null,
});

line("Tasuki · 训练报告");
if (snapshot.exportedAt) {
  const t = new Date(snapshot.exportedAt).toLocaleString("zh-CN", { timeZone, hour12: false });
  line(`数据更新于 ${t}`);
}
line();

if (runs.length === 0) {
  line("还没有跑步记录。");
  process.exit(0);
}

line(
  `跑步记录：${runs.length} 次，共 ${totalKm.toFixed(1)} km，` +
    `最早 ${localDate(runs[0].start, timeZone)}；其中 ${runsWithHr.length} 次带心率。`,
);

if (!hrMax) {
  line("没有年龄，也没有心率数据，暂时无法划分心率区间。可以用 --hrmax 手动指定最大心率。");
  process.exit(0);
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
    line(
      "  分布：" + ZONES.map((z) => `${z.zone} 区 ${counts.get(z.zone) ?? 0} 次`).join(" · "),
    );
  }
}
line();

// 教练建议
const insights = runRules({ activities: snapshot.activities, hrMax: hrMax.value, now, timeZone });
line("建议");
if (insights.length === 0) {
  line("  目前没有需要调整的地方，继续保持。");
}
for (const ins of insights) {
  line(`  ${ins.severity === "warning" ? "⚠" : "·"} ${ins.title}`);
  line(`    发现：${ins.finding}`);
  line(`    建议：${ins.suggestion}`);
  const flagged = ins.evidence.filter((e) => e.flagged);
  if (flagged.length > 0) {
    line(
      "    依据：" +
        flagged
          .map((e) => `${shortDate(e.date)} 心率 ${e.avgHr}（${Math.floor((e.pctOfMax ?? 0) * 100)}%）`)
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
