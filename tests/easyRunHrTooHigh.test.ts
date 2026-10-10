import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { Activity } from "#schema";
import { loadMetricBridge } from "#adapters/metricbridge";
import { easyRunHrTooHigh } from "#engine/rules/easyRunHrTooHigh.ts";
import { loadCard } from "#knowledge";

const SAMPLE = path.join(import.meta.dirname, "../fixtures/metricbridge-sample");
const NOW = new Date("2026-10-01T12:00:00Z");
const ctx = (activities: Activity[]) => ({
  activities,
  hrMax: 190,
  now: NOW,
  timeZone: "Asia/Shanghai",
});

test("多数跑步心率过高时触发，并列出依据", () => {
  const { activities } = loadMetricBridge(SAMPLE);
  const insight = easyRunHrTooHigh.run(ctx(activities));
  assert.ok(insight);
  // 窗口内带心率的跑步：165、140、168；8 月那次和骑行不算，没心率的不算
  assert.equal(insight.evidence.length, 3);
  assert.deepEqual(
    insight.evidence.map((e) => e.flagged),
    [true, false, true],
  );
  assert.match(insight.finding, /3 次带心率的跑步里，2 次/);
  assert.match(insight.suggestion, /133/); // 190 × 70%
  assert.equal(insight.evidence.at(-1)?.date, "2026-09-30"); // 按北京时间
});

test("跑步都在轻松区间时不触发", () => {
  const { activities } = loadMetricBridge(SAMPLE);
  const easy = activities.map((a) => (a.avgHr != null ? { ...a, avgHr: 125 } : a));
  assert.equal(easyRunHrTooHigh.run(ctx(easy)), null);
});

test("没有带心率的跑步时不触发", () => {
  const { activities } = loadMetricBridge(SAMPLE);
  const noHr = activities.map((a) => ({ ...a, avgHr: null }));
  assert.equal(easyRunHrTooHigh.run(ctx(noHr)), null);
});

test("关联的知识卡存在", () => {
  const { activities } = loadMetricBridge(SAMPLE);
  const insight = easyRunHrTooHigh.run(ctx(activities));
  const card = loadCard(insight?.cardId ?? "");
  assert.ok(card, "规则引用的知识卡必须存在");
  assert.equal(card.status, "draft");
});
