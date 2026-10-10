// 本地数据库（SQLite，一个文件）。
// 所有数据源导入的数据都存在这里，报告和建议都从这里读。
// 用的是 Node.js 自带的 node:sqlite，不需要安装数据库软件。
//
// 同一次跑步可能同时来自 MetricBridge 和官方导出包。入库时各存各的（方便重新导入），
// 读取时再按“同一运动类型 + 开始时间相差 2 分钟内”合并成一条。

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Activity, DailyMetrics, HealthSnapshot, RaceGoal } from "#schema";

export const DEFAULT_DB = path.join(process.cwd(), "data", "tasuki.db");

/** 合并时优先采用的数据源顺序：前面的来源的非空字段优先 */
export const SOURCE_PRIORITY = ["metricbridge", "apple-export"];

/** 两条记录开始时间相差不超过这个秒数，就当作同一次运动 */
export const MERGE_WINDOW_SEC = 120;

const SCHEMA_VERSION = 1;

export type Store = DatabaseSync;

export function openStore(file: string = DEFAULT_DB): Store {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activities (
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      raw_type TEXT NOT NULL,
      start TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      duration_sec REAL NOT NULL,
      distance_m REAL,
      avg_hr REAL,
      max_hr REAL,
      active_kcal REAL,
      elevation_gain_m REAL,
      avg_power_w REAL,
      stride_m REAL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (source, source_id)
    );
    CREATE INDEX IF NOT EXISTS activities_start ON activities (start_ms);
    CREATE TABLE IF NOT EXISTS daily_metrics (
      metric TEXT NOT NULL,
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      value REAL NOT NULL,
      PRIMARY KEY (metric, date, source)
    );
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      distance_m REAL NOT NULL,
      target_sec REAL NOT NULL,
      start_date TEXT NOT NULL,
      deadline TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      source TEXT PRIMARY KEY,
      exported_at TEXT,
      synced_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").run(
    String(SCHEMA_VERSION),
  );
  return db;
}

export interface SaveResult {
  activities: number;
  dailyValues: number;
}

/** 保存一个数据源的快照。同一来源、同一 ID 的记录会被覆盖，所以重复导入是安全的。 */
export function saveSnapshot(db: Store, snapshot: HealthSnapshot): SaveResult {
  const now = new Date().toISOString();
  const insertActivity = db.prepare(`
    INSERT OR REPLACE INTO activities
      (source, source_id, sport, raw_type, start, start_ms, duration_sec, distance_m, avg_hr, max_hr,
       active_kcal, elevation_gain_m, avg_power_w, stride_m, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertDaily = db.prepare(
    "INSERT OR REPLACE INTO daily_metrics (metric, date, source, value) VALUES (?, ?, ?, ?)",
  );
  let dailyValues = 0;
  db.exec("BEGIN");
  try {
    for (const a of snapshot.activities) {
      insertActivity.run(
        snapshot.source,
        a.id,
        a.sport,
        a.rawType,
        a.start,
        Date.parse(a.start),
        a.durationSec,
        a.distanceM,
        a.avgHr,
        a.maxHr,
        a.activeKcal,
        a.elevationGainM,
        a.avgPowerW,
        a.strideM,
        now,
      );
    }
    for (const [metric, byDate] of Object.entries(snapshot.daily)) {
      for (const [date, value] of Object.entries(byDate)) {
        insertDaily.run(metric, date, snapshot.source, value);
        dailyValues++;
      }
    }
    db.prepare(
      "INSERT OR REPLACE INTO sync_log (source, exported_at, synced_at) VALUES (?, ?, ?)",
    ).run(snapshot.source, snapshot.exportedAt, now);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { activities: snapshot.activities.length, dailyValues };
}

function rowToActivity(r: any): Activity {
  return {
    id: r.source_id,
    source: r.source,
    sport: r.sport,
    rawType: r.raw_type,
    start: r.start,
    durationSec: r.duration_sec,
    distanceM: r.distance_m,
    avgHr: r.avg_hr,
    maxHr: r.max_hr,
    activeKcal: r.active_kcal,
    elevationGainM: r.elevation_gain_m,
    avgPowerW: r.avg_power_w,
    strideM: r.stride_m,
  };
}

function priority(source: string): number {
  const i = SOURCE_PRIORITY.indexOf(source);
  return i === -1 ? SOURCE_PRIORITY.length : i;
}

const MERGE_FIELDS = [
  "distanceM",
  "avgHr",
  "maxHr",
  "activeKcal",
  "elevationGainM",
  "avgPowerW",
  "strideM",
] as const;

/** 把来自不同数据源的同一次运动合并成一条：每个字段取优先来源里第一个非空的值。 */
export function mergeActivities(list: Activity[]): Activity[] {
  const sorted = [...list].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const groups: Activity[][] = [];
  for (const a of sorted) {
    const t = Date.parse(a.start);
    const group = groups.find(
      (g) =>
        g[0].sport === a.sport &&
        !g.some((x) => x.source === a.source) &&
        Math.abs(Date.parse(g[0].start) - t) <= MERGE_WINDOW_SEC * 1000,
    );
    if (group) group.push(a);
    else groups.push([a]);
  }
  return groups.map((g) => {
    if (g.length === 1) return g[0];
    const ordered = [...g].sort((a, b) => priority(a.source) - priority(b.source));
    const merged: Activity = { ...ordered[0], mergedFrom: ordered.map((a) => a.source) };
    for (const field of MERGE_FIELDS) {
      if (merged[field] == null) {
        merged[field] = ordered.find((a) => a[field] != null)?.[field] ?? null;
      }
    }
    return merged;
  });
}

/** 读取全部运动记录（已跨来源合并、按时间排序） */
export function loadActivities(db: Store): Activity[] {
  const rows = db.prepare("SELECT * FROM activities ORDER BY start_ms").all();
  return mergeActivities(rows.map(rowToActivity));
}

/** 读取每日指标：同一天多个来源时取优先来源的值 */
export function loadDaily(db: Store): DailyMetrics {
  const rows = db.prepare("SELECT metric, date, source, value FROM daily_metrics").all() as any[];
  rows.sort((a, b) => priority(b.source) - priority(a.source)); // 优先来源最后写入，覆盖其他
  const daily: DailyMetrics = {};
  for (const r of rows) (daily[r.metric] ??= {})[r.date] = r.value;
  return daily;
}

export interface SyncInfo {
  source: string;
  exportedAt: string | null;
  syncedAt: string;
}

export function loadSyncLog(db: Store): SyncInfo[] {
  return (db.prepare("SELECT * FROM sync_log ORDER BY source").all() as any[]).map((r) => ({
    source: r.source,
    exportedAt: r.exported_at,
    syncedAt: r.synced_at,
  }));
}

// ---------- 目标 ----------
// 一期同一时间只有一个进行中的成绩目标；设新目标时，旧目标自动归档（保留历史）。

export function setRaceGoal(
  db: Store,
  goal: Omit<RaceGoal, "id">,
): RaceGoal {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE goals SET active = 0 WHERE active = 1 AND kind = 'race'").run();
    const r = db
      .prepare(
        `INSERT INTO goals (kind, distance_m, target_sec, start_date, deadline, active, created_at)
         VALUES ('race', ?, ?, ?, ?, 1, ?)`,
      )
      .run(goal.distanceM, goal.targetSec, goal.startDate, goal.deadline, new Date().toISOString());
    db.exec("COMMIT");
    return { id: Number(r.lastInsertRowid), ...goal };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function loadRaceGoal(db: Store): RaceGoal | null {
  const r = db
    .prepare("SELECT * FROM goals WHERE active = 1 AND kind = 'race' ORDER BY id DESC LIMIT 1")
    .get() as any;
  if (!r) return null;
  return {
    id: r.id,
    distanceM: r.distance_m,
    targetSec: r.target_sec,
    startDate: r.start_date,
    deadline: r.deadline,
  };
}

/** 归档当前目标，返回是否有目标被归档 */
export function clearRaceGoal(db: Store): boolean {
  const r = db.prepare("UPDATE goals SET active = 0 WHERE active = 1 AND kind = 'race'").run();
  return Number(r.changes) > 0;
}
