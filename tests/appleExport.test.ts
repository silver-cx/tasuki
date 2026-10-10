import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadAppleExport, parseAppleDate } from "#adapters/apple-export";

const SAMPLE = path.join(import.meta.dirname, "../fixtures/apple-export-sample");

test("时间格式转换为 UTC", () => {
  assert.equal(parseAppleDate("2026-10-10 21:03:48 +0800"), "2026-10-10T13:03:48.000Z");
});

test("从解压后的文件夹读取运动和体重", async () => {
  const snap = await loadAppleExport(SAMPLE);
  assert.equal(snap.source, "apple-export");
  assert.equal(snap.exportedAt, "2026-10-01T12:00:00.000Z");
  assert.equal(snap.activities.length, 3);

  const [old, recent, ride] = snap.activities;
  // 旧格式：距离和能量写在 Workout 自身属性上
  assert.equal(old.sport, "running");
  assert.equal(old.distanceM, 4200);
  assert.equal(old.durationSec, 1830);
  assert.equal(old.avgHr, null);

  // 新格式：心率、距离等在 WorkoutStatistics 里
  assert.equal(recent.avgHr, 138);
  assert.equal(recent.maxHr, 150);
  assert.equal(recent.distanceM, 5010);
  assert.equal(recent.activeKcal, 310);
  assert.equal(recent.avgPowerW, 160);
  assert.equal(recent.elevationGainM, 12.5);
  assert.equal(recent.id, "HKWorkoutActivityTypeRunning@2026-09-24T23:00:30.000Z");

  assert.equal(ride.sport, "cycling");
  assert.equal(ride.distanceM, 18000);

  // 体重：磅换算成公斤
  assert.deepEqual(snap.daily.body_mass_kg, { "2026-01-06": 65, "2026-09-01": 74.84 });
});

test("可以直接读取 zip（中文文件名）", async (t) => {
  if (spawnSync("zip", ["-v"]).status !== 0) return t.skip("没有安装 zip");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tasuki-"));
  const zip = path.join(dir, "导出.zip");
  spawnSync("zip", ["-qr", zip, "apple_health_export"], { cwd: SAMPLE });
  const snap = await loadAppleExport(zip);
  assert.equal(snap.activities.length, 3);
});
