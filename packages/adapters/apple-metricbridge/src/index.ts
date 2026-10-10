// MetricBridge 数据源适配器（一期主通道）。
// MetricBridge 是一个 iPhone App，会把 Apple 健康数据定期写到 iCloud 文件夹。
// 这里只读它写出的两个缓存文件，把它们转换成 Tasuki 的统一数据模型。
// 格式说明见 https://github.com/PhilipAD/health-export-mcp 的 docs/SCHEMA-CONTRACTS.md

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Activity, DailyMetrics, HealthSnapshot, Sport } from "#schema";

export const SOURCE = "metricbridge";

/** 已验证过的缓存格式主版本。主版本变化可能不兼容，遇到就明确报错。 */
export const SUPPORTED_SCHEMA = 1;

export const DEFAULT_DIR = path.join(
  os.homedir(),
  "Library/Mobile Documents/iCloud~ai~healthexport~app/Documents",
);

const CACHE_FILE = ".health-cache.json";
const WORKOUTS_FILE = ".health-workouts-cache.json";

export class MetricBridgeError extends Error {}

const SPORTS: Record<string, Sport> = {
  Running: "running",
  Cycling: "cycling",
  Walking: "walking",
  Hiking: "walking",
  Strength: "strength",
  Tennis: "tennis",
  Yoga: "yoga",
};

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) {
    throw new MetricBridgeError(
      `找不到 ${file}\n请确认 iPhone 上的 MetricBridge 已开启 iCloud 导出，并且这台 Mac 登录了同一个 iCloud 账号。`,
    );
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new MetricBridgeError(`${file} 不是有效的 JSON，可能正在同步中，稍后再试。`);
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function positive(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

function toActivity(raw: any): Activity | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.start !== "string") return null;
  const durationSec = num(raw.duration);
  if (durationSec == null) return null;
  const rawType = String(raw.name ?? "Other");
  return {
    id: raw.id,
    source: SOURCE,
    sport: SPORTS[rawType] ?? "other",
    rawType,
    start: raw.start,
    durationSec,
    distanceM: positive(raw.distanceMeters),
    avgHr: positive(raw.avgHeartRate),
    maxHr: positive(raw.maxHeartRate),
    activeKcal: positive(raw.activeEnergyBurned),
    elevationGainM: num(raw.elevationAscendedMeters),
    avgPowerW: positive(raw.runningPowerAvgWatts),
    strideM: positive(raw.strideLengthAvgMeters),
  };
}

/** 读取 MetricBridge 文件夹，返回统一格式的数据快照。 */
export function loadMetricBridge(dir: string = DEFAULT_DIR): HealthSnapshot {
  const cache = readJson(path.join(dir, CACHE_FILE)) as any;
  const meta = cache?._meta;
  if (meta?.schema !== SUPPORTED_SCHEMA) {
    throw new MetricBridgeError(
      `MetricBridge 缓存格式版本是 ${meta?.schema ?? "未知"}，Tasuki 目前只支持 ${SUPPORTED_SCHEMA}。` +
        "请升级 Tasuki，或到项目 Issues 反馈。",
    );
  }

  const daily: DailyMetrics = {};
  for (const [name, block] of Object.entries(cache)) {
    if (name === "_meta") continue;
    const rows = (block as any)?.daily;
    if (!Array.isArray(rows)) continue;
    const byDate: Record<string, number> = {};
    for (const row of rows) {
      const v = num(row?.v);
      if (typeof row?.d === "string" && v != null) byDate[row.d] = v;
    }
    daily[name] = byDate;
  }

  const rawWorkouts = readJson(path.join(dir, WORKOUTS_FILE));
  if (!Array.isArray(rawWorkouts)) {
    throw new MetricBridgeError(`${WORKOUTS_FILE} 的格式不是预期的列表。`);
  }
  const activities = rawWorkouts
    .map(toActivity)
    .filter((a): a is Activity => a != null)
    .sort((a, b) => a.start.localeCompare(b.start));

  return {
    source: SOURCE,
    exportedAt: typeof meta.writtenAt === "string" ? meta.writtenAt : null,
    activities,
    daily,
  };
}

/** 取某个每日指标最近一天的值，例如年龄 "age"。 */
export function latestDaily(snapshot: HealthSnapshot, metric: string): number | null {
  const byDate = snapshot.daily[metric];
  if (!byDate) return null;
  const dates = Object.keys(byDate).sort();
  const last = dates.at(-1);
  return last ? byDate[last] : null;
}
