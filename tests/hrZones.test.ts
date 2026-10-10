import assert from "node:assert/strict";
import { test } from "node:test";
import type { Activity } from "#schema";
import { estimateHrMax, zoneOf, zoneRange, ZONES } from "#engine/metrics/hrZones.ts";

function run(maxHr: number | null): Activity {
  return {
    id: String(maxHr),
    source: "test",
    sport: "running",
    rawType: "Running",
    start: "2026-09-01T00:00:00Z",
    durationSec: 1800,
    distanceM: 5000,
    avgHr: null,
    maxHr,
    activeKcal: null,
    elevationGainM: null,
    avgPowerW: null,
    strideM: null,
  };
}

test("最大心率：年龄公式和实测值取较大者", () => {
  assert.equal(estimateHrMax({ age: 32, activities: [run(186)] })?.value, 188);
  assert.equal(estimateHrMax({ age: 32, activities: [run(186)] })?.method, "age");
  assert.equal(estimateHrMax({ age: 40, activities: [run(191)] })?.value, 191);
  assert.equal(estimateHrMax({ age: 40, activities: [run(191)] })?.method, "observed");
});

test("最大心率：手动指定优先，没有任何信息时返回 null", () => {
  assert.equal(estimateHrMax({ age: 32, activities: [], manual: 195 })?.value, 195);
  assert.equal(estimateHrMax({ age: null, activities: [run(null)] }), null);
});

test("心率归区：边界值归入较高的区", () => {
  assert.equal(zoneOf(150, 200).zone, 3); // 75%
  assert.equal(zoneOf(160, 200).zone, 4); // 正好 80%
  assert.equal(zoneOf(100, 200).zone, 1); // 50%
  assert.equal(zoneOf(199, 200).zone, 5);
});

test("2 区范围", () => {
  assert.deepEqual(zoneRange(ZONES[1], 188), [113, 132]);
});
