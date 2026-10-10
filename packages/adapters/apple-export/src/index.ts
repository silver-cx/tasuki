// 健康 App 官方导出包适配器（一期，用于补全历史）。
// iPhone「健康」App → 头像 →「导出所有健康数据」会生成一个 zip（中文系统叫“导出.zip”），
// 里面的 apple_health_export/export.xml（中文系统叫“导出.xml”）包含全部历史记录。
//
// 文件可能有几个 GB，所以这里逐行流式读取，不会一次读进内存。
// 一期只取两类数据：
//   - 运动（<Workout>）及其统计（<WorkoutStatistics>：平均/最高心率、距离、能量等）
//   - 体重（HKQuantityTypeIdentifierBodyMass）

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { Readable } from "node:stream";
import type { Activity, HealthSnapshot, Sport } from "#schema";

export const SOURCE = "apple-export";

export class AppleExportError extends Error {}

const SPORTS: Record<string, Sport> = {
  HKWorkoutActivityTypeRunning: "running",
  HKWorkoutActivityTypeCycling: "cycling",
  HKWorkoutActivityTypeWalking: "walking",
  HKWorkoutActivityTypeHiking: "walking",
  HKWorkoutActivityTypeTraditionalStrengthTraining: "strength",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "strength",
  HKWorkoutActivityTypeTennis: "tennis",
  HKWorkoutActivityTypeYoga: "yoga",
};

// ---------- 打开 export.xml（支持 zip、解压后的文件夹、xml 文件） ----------

/** 在 zip 里找主数据文件：apple_health_export/ 下的 .xml，排除 cda（临床文档） */
function pickXmlEntry(entries: string[]): string | null {
  const candidates = entries.filter(
    (e) => /(^|\/)apple_health_export\/[^/]+\.xml$/.test(e) && !/cda/i.test(e),
  );
  return candidates[0] ?? null;
}

function openXml(input: string): Readable {
  if (!fs.existsSync(input)) throw new AppleExportError(`找不到 ${input}`);
  const stat = fs.statSync(input);

  if (stat.isDirectory()) {
    // 可能是解压出来的文件夹本身，或它的上一级
    const dirs = [input, path.join(input, "apple_health_export")];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const xml = fs
        .readdirSync(dir)
        .find((f) => f.endsWith(".xml") && !/cda/i.test(f));
      if (xml) return fs.createReadStream(path.join(dir, xml));
    }
    throw new AppleExportError(`${input} 里没有找到导出的 xml 文件`);
  }

  if (input.endsWith(".zip")) {
    const list = spawnSync("unzip", ["-Z1", input], { encoding: "utf8" });
    if (list.status !== 0) throw new AppleExportError(`无法读取压缩包：${list.stderr}`);
    const entry = pickXmlEntry(list.stdout.split("\n"));
    if (!entry) throw new AppleExportError("压缩包里没有找到 apple_health_export/*.xml");
    // unzip 会把方括号等字符当通配符，这里转义
    const pattern = entry.replace(/([[\]*?])/g, "\\$1");
    return spawn("unzip", ["-p", input, pattern]).stdout;
  }

  return fs.createReadStream(input);
}

// ---------- 解析 ----------

function attrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    out[m[1]] = m[2]
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }
  return out;
}

/** "2026-10-10 21:03:48 +0800" → ISO（UTC） */
export function parseAppleDate(s: string): string {
  const m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!m) throw new AppleExportError(`无法识别的时间格式：${s}`);
  return new Date(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`).toISOString();
}

function toSeconds(value: number, unit: string | undefined): number {
  if (unit === "min") return value * 60;
  if (unit === "hr" || unit === "h") return value * 3600;
  return value;
}

function toMeters(value: number, unit: string | undefined): number | null {
  if (unit === "km") return value * 1000;
  if (unit === "m") return value;
  if (unit === "mi") return value * 1609.344;
  if (unit === "cm") return value / 100;
  return null;
}

function toKcal(value: number, unit: string | undefined): number | null {
  if (unit === "kcal" || unit === "Cal") return value;
  if (unit === "kJ") return value / 4.184;
  return null;
}

function toKg(value: number, unit: string | undefined): number | null {
  if (unit === "kg") return value;
  if (unit === "lb") return value * 0.45359237;
  if (unit === "g") return value / 1000;
  return null;
}

function n(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** 正在解析的一条 Workout（它的统计信息在后面的子元素里） */
interface Pending {
  activity: Activity;
}

function startWorkout(a: Record<string, string>): Pending {
  const start = parseAppleDate(a.startDate);
  const rawType = a.workoutActivityType ?? "HKWorkoutActivityTypeOther";
  const duration = n(a.duration);
  const distance = n(a.totalDistance);
  const energy = n(a.totalEnergyBurned);
  return {
    activity: {
      // 官方导出包没有运动 ID，用“类型 + 开始时间”生成，重复导入时保持一致
      id: `${rawType}@${start}`,
      source: SOURCE,
      sport: SPORTS[rawType] ?? "other",
      rawType: rawType.replace("HKWorkoutActivityType", ""),
      start,
      durationSec:
        duration != null
          ? toSeconds(duration, a.durationUnit)
          : (Date.parse(parseAppleDate(a.endDate)) - Date.parse(start)) / 1000,
      distanceM: distance != null && distance > 0 ? toMeters(distance, a.totalDistanceUnit) : null,
      avgHr: null,
      maxHr: null,
      activeKcal: energy != null && energy > 0 ? toKcal(energy, a.totalEnergyBurnedUnit) : null,
      elevationGainM: null,
      avgPowerW: null,
      strideM: null,
    },
  };
}

function applyStatistic(p: Pending, a: Record<string, string>) {
  const act = p.activity;
  switch (a.type) {
    case "HKQuantityTypeIdentifierHeartRate":
      act.avgHr = n(a.average) ?? act.avgHr;
      act.maxHr = n(a.maximum) ?? act.maxHr;
      break;
    case "HKQuantityTypeIdentifierDistanceWalkingRunning":
    case "HKQuantityTypeIdentifierDistanceCycling": {
      const sum = n(a.sum);
      if (act.distanceM == null && sum != null && sum > 0) act.distanceM = toMeters(sum, a.unit);
      break;
    }
    case "HKQuantityTypeIdentifierActiveEnergyBurned": {
      const sum = n(a.sum);
      if (act.activeKcal == null && sum != null && sum > 0) act.activeKcal = toKcal(sum, a.unit);
      break;
    }
    case "HKQuantityTypeIdentifierRunningPower":
      act.avgPowerW = n(a.average) ?? act.avgPowerW;
      break;
    case "HKQuantityTypeIdentifierRunningStrideLength":
      act.strideM = n(a.average) ?? act.strideM;
      break;
  }
}

function applyMetadata(p: Pending, a: Record<string, string>) {
  if (a.key === "HKElevationAscended" && a.value) {
    const [v, unit] = a.value.split(" ");
    const value = n(v);
    if (value != null) p.activity.elevationGainM = toMeters(value, unit);
  }
}

export interface ImportProgress {
  lines: number;
  workouts: number;
}

/**
 * 读取官方导出包，返回统一格式的快照。
 * @param input 导出的 zip、解压后的文件夹，或 export.xml 本身
 * @param onProgress 每读 50 万行回调一次，用于显示进度
 */
export async function loadAppleExport(
  input: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<HealthSnapshot> {
  const stream = openXml(input);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const activities: Activity[] = [];
  const weight: Record<string, number> = {};
  let exportedAt: string | null = null;
  let pending: Pending | null = null;
  let lines = 0;

  for await (const raw of rl) {
    lines++;
    if (onProgress && lines % 500_000 === 0) onProgress({ lines, workouts: activities.length });
    const line = raw.trimStart();
    if (!line.startsWith("<")) continue;

    if (pending) {
      if (line.startsWith("</Workout>")) {
        activities.push(pending.activity);
        pending = null;
      } else if (line.startsWith("<WorkoutStatistics ")) {
        applyStatistic(pending, attrs(line));
      } else if (line.startsWith("<MetadataEntry ")) {
        applyMetadata(pending, attrs(line));
      }
      continue;
    }

    if (line.startsWith("<Workout ")) {
      const p = startWorkout(attrs(line));
      if (line.endsWith("/>")) activities.push(p.activity);
      else pending = p;
    } else if (line.startsWith('<Record type="HKQuantityTypeIdentifierBodyMass"')) {
      const a = attrs(line);
      const kg = toKg(Number(a.value), a.unit);
      if (kg != null && a.startDate) weight[a.startDate.slice(0, 10)] = Math.round(kg * 100) / 100;
    } else if (line.startsWith("<ExportDate ")) {
      const value = attrs(line).value;
      if (value) exportedAt = parseAppleDate(value);
    }
  }

  if (lines === 0) throw new AppleExportError("导出文件是空的，或者解压失败。");

  activities.sort((a, b) => a.start.localeCompare(b.start));
  return {
    source: SOURCE,
    exportedAt,
    activities,
    daily: Object.keys(weight).length > 0 ? { body_mass_kg: weight } : {},
  };
}
