// 显示用的小工具：配速、日期。

/** 秒/公里 → "6:27" */
export function fmtPace(secPerKm: number | null): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return "—";
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 一次跑步的配速（秒/公里），没有距离时为 null */
export function paceOf(durationSec: number, distanceM: number | null): number | null {
  return distanceM ? durationSec / (distanceM / 1000) : null;
}

/** ISO 时间 → 指定时区的 "YYYY-MM-DD" */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** "2026-09-21" → "9/21" */
export function shortDate(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}
