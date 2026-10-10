// Tasuki 命令行入口。
//
// 命令：
//   npm run report                    同步 MetricBridge 的最新数据，然后输出训练报告
//   npm run sync                      只同步 MetricBridge 数据
//   npm run import -- <导出包路径>     导入健康 App 的官方导出包（zip 或解压后的文件夹）
//   npm run goal                      查看当前目标
//   npm run goal -- set --distance 5 --time 30:00 --by 2026-11-30   设置成绩目标
//   npm run goal -- clear             取消当前目标
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
import { distanceName, fmtDuration, localDate, parseDuration } from "#engine/format.ts";
import {
  DEFAULT_DB,
  clearRaceGoal,
  loadRaceGoal,
  setRaceGoal,
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
    distance: { type: "string" },
    time: { type: "string" },
    by: { type: "string" },
  },
});

const timeZone = values.tz as string;
const now = values.now ? new Date(`${values.now}T23:59:59+08:00`) : new Date();

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

const DISTANCES: Record<string, number> = {
  半马: 21097.5,
  half: 21097.5,
  全马: 42195,
  marathon: 42195,
};

function goal(db: Store, action: string | undefined) {
  if (action === "set") {
    const distanceM =
      DISTANCES[values.distance ?? ""] ?? (Number(values.distance) > 0 ? Number(values.distance) * 1000 : NaN);
    const targetSec = values.time ? parseDuration(values.time) : null;
    const deadline = values.by ?? "";
    if (!Number.isFinite(distanceM)) fail("--distance 填公里数（如 5、10）或 半马、全马");
    if (!targetSec) fail("--time 填目标用时，如 30:00 或 1:55:00");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) fail("--by 填截止日期，如 2026-11-30");
    const startDate = localDate(now.toISOString(), timeZone);
    if (deadline <= startDate) fail("截止日期需要晚于今天");
    setRaceGoal(db, { distanceM, targetSec, startDate, deadline });
    console.log(`已设置目标：${deadline} 前 ${distanceName(distanceM)} 跑进 ${fmtDuration(targetSec)}。`);
    console.log("运行 npm run report 查看进度和预测。");
  } else if (action === "clear") {
    console.log(clearRaceGoal(db) ? "已取消当前目标（记录仍保留在数据库里）。" : "当前没有目标。");
  } else if (action == null) {
    const g = loadRaceGoal(db);
    console.log(
      g
        ? `当前目标：${g.deadline} 前 ${distanceName(g.distanceM)} 跑进 ${fmtDuration(g.targetSec)}（设于 ${g.startDate}）。`
        : "还没有设置目标。例如：npm run goal -- set --distance 5 --time 30:00 --by 2026-11-30",
    );
  } else {
    fail(`不认识的操作：${action}。可用：set、clear`);
  }
}

function report(db: Store) {
  printReport({
    activities: loadActivities(db),
    daily: loadDaily(db),
    syncLog: loadSyncLog(db),
    days: Number(values.days),
    now,
    timeZone,
    hrmax: values.hrmax ? Number(values.hrmax) : null,
    goal: loadRaceGoal(db),
  });
}

if (Number.isNaN(now.getTime())) fail("--now 的格式应为 YYYY-MM-DD，例如 2026-10-01");

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
  case "goal":
    goal(db, rest[0]);
    break;
  default:
    fail(`不认识的命令：${command}。可用命令：report、sync、import、goal`);
}

db.close();
