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

/** 秒 → "32:15"，超过一小时 → "1:02:03" */
export function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "30:00" / "1:45:00" → 秒；格式不对返回 null */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    return null;
  }
  return parts.reduce((total, p) => total * 60 + p, 0);
}

/** 距离的显示名：5000 → "5 km"，21097.5 → "半程马拉松" */
export function distanceName(m: number): string {
  if (Math.abs(m - 21097.5) < 50) return "半程马拉松";
  if (Math.abs(m - 42195) < 50) return "全程马拉松";
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}
