import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadAppleExport } from "#adapters/apple-export";
import { loadMetricBridge } from "#adapters/metricbridge";
import { loadActivities, loadDaily, loadSyncLog, openStore, saveSnapshot } from "#store";

const FIXTURES = path.join(import.meta.dirname, "../fixtures");

test("两个数据源的同一次跑步合并成一条，互相补全字段", async () => {
  const db = openStore(":memory:");
  saveSnapshot(db, loadMetricBridge(path.join(FIXTURES, "metricbridge-sample")));
  saveSnapshot(db, await loadAppleExport(path.join(FIXTURES, "apple-export-sample")));

  const all = loadActivities(db);
  // MetricBridge 6 条 + 导出包 3 条，其中 9/25 那次跑步重复
  assert.equal(all.length, 8);

  const merged = all.find((a) => a.mergedFrom);
  assert.ok(merged);
  assert.deepEqual(merged.mergedFrom, ["metricbridge", "apple-export"]);
  // MetricBridge 那条没有心率，由导出包补上
  assert.equal(merged.avgHr, 138);
  // 距离两边都有，用优先来源 MetricBridge 的
  assert.equal(merged.distanceM, 5000);

  // 只在导出包里的 2025 年跑步也在
  assert.ok(all.some((a) => a.start.startsWith("2025-07-11")));
});

test("重复导入不会产生重复记录", async () => {
  const db = openStore(":memory:");
  const snap = await loadAppleExport(path.join(FIXTURES, "apple-export-sample"));
  saveSnapshot(db, snap);
  saveSnapshot(db, snap);
  assert.equal(loadActivities(db).length, 3);
});

test("每日指标和同步记录", async () => {
  const db = openStore(":memory:");
  saveSnapshot(db, loadMetricBridge(path.join(FIXTURES, "metricbridge-sample")));
  saveSnapshot(db, await loadAppleExport(path.join(FIXTURES, "apple-export-sample")));
  const daily = loadDaily(db);
  assert.equal(daily.age["2026-01-01"], 30);
  assert.equal(daily.body_mass_kg["2026-01-06"], 65);
  assert.deepEqual(
    loadSyncLog(db).map((s) => s.source),
    ["apple-export", "metricbridge"],
  );
});
