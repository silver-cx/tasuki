import assert from "node:assert/strict";
import { test } from "node:test";
import type { Activity, RaceGoal } from "#schema";
import { fmtDuration, parseDuration } from "#engine/format.ts";
import { assessGoal } from "#engine/goals/progress.ts";
import { efforts, riegel } from "#engine/metrics/performance.ts";
import { weeklyVolume } from "#engine/metrics/volume.ts";
import { goalOffTrack } from "#engine/rules/goalOffTrack.ts";
import { volumeRamp } from "#engine/rules/volumeRamp.ts";
import { loadCard } from "#knowledge";
import { clearRaceGoal, loadRaceGoal, openStore, setRaceGoal } from "#store";

const NOW = new Date("2026-10-10T14:00:00Z");
const DAY = 864e5;

/** 生成一次跑步：daysAgo 天前，distanceKm 公里，用时 minutes 分钟 */
function run(daysAgo: number, distanceKm: number, minutes: number): Activity {
  return {
    id: `r${daysAgo}-${distanceKm}`,
    source: "test",
    sport: "running",
    rawType: "Running",
    start: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    durationSec: minutes * 60,
    distanceM: distanceKm * 1000,
    avgHr: null,
    maxHr: null,
    activeKcal: null,
    elevationGainM: null,
    avgPowerW: null,
    strideM: null,
  };
}

const goal = (deadline: string): RaceGoal => ({
  id: 1,
  distanceM: 5000,
  targetSec: 30 * 60,
  startDate: "2026-09-01",
  deadline,
});

test("用时格式", () => {
  assert.equal(parseDuration("30:00"), 1800);
  assert.equal(parseDuration("1:55:00"), 6900);
  assert.equal(parseDuration("30"), null);
  assert.equal(parseDuration("abc"), null);
  assert.equal(fmtDuration(1935), "32:15");
  assert.equal(fmtDuration(6900), "1:55:00");
});

test("Riegel 换算：10 km 60 分钟 ≈ 5 km 28:47", () => {
  assert.equal(fmtDuration(riegel(3600, 10000, 5000)), "28:47");
});

test("成绩估算只用合格的跑步", () => {
  const list = efforts(
    [run(1, 5, 32), run(2, 1.5, 8), run(3, 5, 75), { ...run(4, 5, 30), sport: "cycling" }],
    5000,
  );
  assert.equal(list.length, 1); // 太短、太慢（走路）、骑行都被排除
});

test("落后：按趋势赶不上截止日", () => {
  // 之前 4 周最好 33:00，最近 4 周最好 32:00 → 每周快 15 秒；还差 120 秒 → 需要 8 周
  const acts = [run(40, 5, 33), run(3, 5, 32), run(10, 5, 34)];
  const p = assessGoal(goal("2026-11-07"), acts, NOW); // 只剩 4 周
  assert.equal(p.status, "behind");
  assert.equal(p.ratePerWeek, 15);
  assert.equal(p.gapSec, 120);
  assert.ok(p.projectedAtDeadlineSec != null && p.projectedAtDeadlineSec > 1800);
});

test("正常：截止日足够远", () => {
  const acts = [run(40, 5, 33), run(3, 5, 32)];
  assert.equal(assessGoal(goal("2026-12-31"), acts, NOW).status, "on-track");
});

test("已达成、无趋势、无数据、已过期", () => {
  assert.equal(assessGoal(goal("2026-12-31"), [run(3, 5, 29.5)], NOW).status, "achieved");
  assert.equal(assessGoal(goal("2026-12-31"), [run(40, 5, 31), run(3, 5, 32)], NOW).status, "no-trend");
  assert.equal(assessGoal(goal("2026-12-31"), [run(3, 5, 32)], NOW).status, "no-trend");
  assert.equal(assessGoal(goal("2026-12-31"), [run(40, 5, 32)], NOW).status, "no-data");
  assert.equal(assessGoal(goal("2026-10-01"), [run(3, 5, 32)], NOW).status, "expired");
});

test("目标落后时给出建议，并提到历史最好成绩", () => {
  const acts = [run(200, 5, 28.5), run(40, 5, 33), run(3, 5, 32)];
  const ctx = { activities: acts, hrMax: 190, now: NOW, timeZone: "Asia/Shanghai" };
  const insight = goalOffTrack.run({ ...ctx, goal: goal("2026-11-07") });
  assert.ok(insight);
  assert.match(insight.finding, /能力范围内/);
  assert.match(insight.suggestion, /调整目标/);
  assert.equal(goalOffTrack.run({ ...ctx, goal: goal("2026-12-31") }), null);
  assert.equal(goalOffTrack.run({ ...ctx, goal: null }), null);
});

test("每 7 天跑量", () => {
  const weeks = weeklyVolume([run(1, 5, 32), run(3, 10, 65), run(9, 5, 33)], NOW, 3);
  assert.deepEqual(
    weeks.map((w) => w.km),
    [0, 5, 15],
  );
});

test("跑量增长过快时提醒，基数太小时不提醒", () => {
  const ctx = (acts: Activity[]) => ({ activities: acts, hrMax: 190, now: NOW, timeZone: "Asia/Shanghai" });
  const steady = [8, 15, 22, 29].map((d) => run(d, 10, 65));
  assert.equal(volumeRamp.run(ctx([...steady, run(2, 10, 65)])), null);
  const ramp = volumeRamp.run(ctx([...steady, run(2, 10, 65), run(4, 10, 65)]));
  assert.ok(ramp);
  assert.match(ramp.finding, /20 km/);
  assert.equal(volumeRamp.run(ctx([run(30, 3, 20), run(2, 10, 65)])), null);
});

test("目标存取：新目标替换旧目标", () => {
  const db = openStore(":memory:");
  assert.equal(loadRaceGoal(db), null);
  setRaceGoal(db, { distanceM: 5000, targetSec: 1800, startDate: "2026-09-01", deadline: "2026-11-16" });
  setRaceGoal(db, { distanceM: 5000, targetSec: 1800, startDate: "2026-10-11", deadline: "2026-11-30" });
  assert.equal(loadRaceGoal(db)?.deadline, "2026-11-30");
  assert.equal(clearRaceGoal(db), true);
  assert.equal(loadRaceGoal(db), null);
});

test("规则引用的知识卡都存在", () => {
  for (const id of ["easy-run-slow", "improve-5k", "mileage-increase"]) {
    assert.ok(loadCard(id), `缺少知识卡 ${id}`);
  }
});
