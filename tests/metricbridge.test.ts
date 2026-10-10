import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MetricBridgeError, latestDaily, loadMetricBridge } from "#adapters/metricbridge";

const SAMPLE = path.join(import.meta.dirname, "../fixtures/metricbridge-sample");

test("读取样例数据并转换成统一格式", () => {
  const snap = loadMetricBridge(SAMPLE);
  assert.equal(snap.source, "metricbridge");
  assert.equal(snap.exportedAt, "2026-10-01T12:00:00Z");
  // 缺少 id 的坏记录被忽略
  assert.equal(snap.activities.length, 6);
  // 按时间排序
  assert.equal(snap.activities[0].id, "sample-run-old");
  const ride = snap.activities.find((a) => a.id === "sample-ride");
  assert.equal(ride?.sport, "cycling");
  const noHr = snap.activities.find((a) => a.id === "sample-run-no-hr");
  assert.equal(noHr?.avgHr, null, "没测到的心率是 null，不是 0");
  assert.equal(latestDaily(snap, "age"), 30);
  assert.equal(latestDaily(snap, "resting_heart_rate"), 61);
});

test("不认识的格式版本会明确报错", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tasuki-"));
  fs.writeFileSync(path.join(dir, ".health-cache.json"), JSON.stringify({ _meta: { schema: 2 } }));
  fs.writeFileSync(path.join(dir, ".health-workouts-cache.json"), "[]");
  assert.throws(() => loadMetricBridge(dir), MetricBridgeError);
});

test("文件夹不存在时给出可读的提示", () => {
  assert.throws(() => loadMetricBridge("/no/such/folder"), /找不到/);
});
