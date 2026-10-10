// Tasuki 命令行入口。
//
// 命令：
//   npm run report                    同步 MetricBridge 的最新数据，然后输出训练报告
//   npm run sync                      只同步 MetricBridge 数据
//   npm run import -- <导出包路径>     导入健康 App 的官方导出包（zip 或解压后的文件夹）
//
// 通用参数：
//   --db <文件>       数据库位置（默认 data/tasuki.db）
//   --data <文件夹>   MetricBridge 数据文件夹（默认是 iCloud 里的 MetricBridge 目录）
//   --no-sync         report 时不先同步
//   --days <天数>     报告覆盖最近多少天（默认 14）
//   --hrmax <心率>    手动指定最大心率，覆盖估算
//   --tz <时区>       默认 Asia/Shanghai
//   --now <日期>      把“今天”当作某一天，用于回看过去或演示样例数据，例如 2026-10-01

import { parseArgs } from "node:util";
import { AppleExportError, loadAppleExport } from "#adapters/apple-export";
import { DEFAULT_DIR, MetricBridgeError, loadMetricBridge } from "#adapters/metricbridge";
import {
  DEFAULT_DB,
  loadActivities,
  loadDaily,
  loadSyncLog,
  openStore,
  saveSnapshot,
  type Store,
} from "#store";
import { printReport } from "./report.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: "string", default: DEFAULT_DB },
    data: { type: "string", default: DEFAULT_DIR },
    "no-sync": { type: "boolean", default: false },
    days: { type: "string", default: "14" },
    hrmax: { type: "string" },
    tz: { type: "string", default: "Asia/Shanghai" },
    now: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** 从 MetricBridge 同步到数据库。quiet=true 时找不到数据只提示不报错（report 用）。 */
function syncMetricBridge(db: Store, quiet: boolean) {
  try {
    const snap = loadMetricBridge(values.data);
    const r = saveSnapshot(db, snap);
    if (!quiet) console.log(`已同步 MetricBridge：${r.activities} 次运动，${r.dailyValues} 条每日指标。`);
  } catch (err) {
    if (!(err instanceof MetricBridgeError)) throw err;
    if (quiet) console.log(`（跳过 MetricBridge 同步：${err.message.split("\n")[0]}）\n`);
    else fail(`同步失败：${err.message}`);
  }
}

async function importExport(db: Store, input: string | undefined) {
  if (!input) fail("请提供导出包路径，例如：npm run import -- ~/Downloads/导出.zip");
  console.log(`正在读取 ${input}，文件较大时需要一两分钟……`);
  try {
    let progressShown = false;
    const snap = await loadAppleExport(input, (p) => {
      progressShown = true;
      process.stdout.write(`\r  已读取 ${(p.lines / 1e6).toFixed(1)} 百万行，找到 ${p.workouts} 次运动`);
    });
    if (progressShown) process.stdout.write("\n");
    const r = saveSnapshot(db, snap);
    const runs = snap.activities.filter((a) => a.sport === "running");
    const withHr = runs.filter((a) => a.avgHr != null).length;
    console.log(
      `已导入：${r.activities} 次运动（其中跑步 ${runs.length} 次，${withHr} 次带心率），` +
        `${r.dailyValues} 条体重记录。`,
    );
  } catch (err) {
    if (err instanceof AppleExportError) fail(`导入失败：${err.message}`);
    throw err;
  }
}

function report(db: Store) {
  const now = values.now ? new Date(`${values.now}T23:59:59+08:00`) : new Date();
  if (Number.isNaN(now.getTime())) fail("--now 的格式应为 YYYY-MM-DD，例如 2026-10-01");
  printReport({
    activities: loadActivities(db),
    daily: loadDaily(db),
    syncLog: loadSyncLog(db),
    days: Number(values.days),
    now,
    timeZone: values.tz as string,
    hrmax: values.hrmax ? Number(values.hrmax) : null,
  });
}

const [command = "report", ...rest] = positionals;
const db = openStore(values.db);

switch (command) {
  case "report":
    if (!values["no-sync"]) syncMetricBridge(db, true);
    report(db);
    break;
  case "sync":
    syncMetricBridge(db, false);
    break;
  case "import":
    await importExport(db, rest[0]);
    break;
  default:
    fail(`不认识的命令：${command}。可用命令：report、sync、import`);
}

db.close();
