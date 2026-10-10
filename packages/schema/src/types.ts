// Tasuki 的统一数据模型。
// 每个数据源（MetricBridge、官方导出包、以后的 Strava……）都先转换成这里的格式，
// 教练引擎和页面只认识这些类型，不关心数据从哪来。

export type Sport =
  | "running"
  | "cycling"
  | "walking"
  | "strength"
  | "tennis"
  | "yoga"
  | "other";

/** 一次运动记录。缺失的数值用 null，而不是 0，避免把“没测”当成“为零”。 */
export interface Activity {
  /** 来源内的唯一 ID */
  id: string;
  /** 数据源名称，例如 "metricbridge" */
  source: string;
  sport: Sport;
  /** 数据源里的原始运动类型名，便于排查 */
  rawType: string;
  /** 开始时间，ISO 8601（UTC） */
  start: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  activeKcal: number | null;
  elevationGainM: number | null;
  avgPowerW: number | null;
  strideM: number | null;
  /** 同一次运动出现在多个数据源时，合并后记录所有来源，例如 ["metricbridge", "apple-export"] */
  mergedFrom?: string[];
}

/** 成绩目标：在截止日前，用不超过 targetSec 的时间跑完 distanceM */
export interface RaceGoal {
  id: number;
  distanceM: number;
  targetSec: number;
  /** 设定目标的日期 YYYY-MM-DD */
  startDate: string;
  /** 截止日期 YYYY-MM-DD（含当天） */
  deadline: string;
}

/** 每日指标：指标名 → 日期（YYYY-MM-DD）→ 数值 */
export type DailyMetrics = Record<string, Record<string, number>>;

/** 一个数据源一次读取的全部结果 */
export interface HealthSnapshot {
  source: string;
  /** 数据源最后一次写出数据的时间，未知则为 null */
  exportedAt: string | null;
  activities: Activity[];
  daily: DailyMetrics;
}
