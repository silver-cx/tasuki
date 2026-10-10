import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadAppleExport } from "#adapters/apple-export";
import { loadMetricBridge } from "#adapters/metricbridge";
import { openStore, saveSnapshot, setRaceGoal } from "#store";
import { buildContext } from "../apps/cli/src/context.ts";
import { esc, markdownToHtml } from "../apps/cli/src/dashboard/markdown.ts";
import { renderDashboard } from "../apps/cli/src/dashboard/page.ts";
import { regeneratePlan } from "../apps/cli/src/plan.ts";

const FIXTURES = path.join(import.meta.dirname, "../fixtures");

test("Markdown 转换：标题、列表、粗体，并转义 HTML", () => {
  const html = markdownToHtml("## 一句话\n\n**慢**下来 <b>\n\n- 甲\n- 乙\n\n1. 一\n2. 二");
  assert.match(html, /<h4>一句话<\/h4>/);
  assert.match(html, /<strong>慢<\/strong>下来 &lt;b&gt;/);
  assert.match(html, /<ul>\n<li>甲<\/li>\n<li>乙<\/li>\n<\/ul>/);
  assert.match(html, /<ol>/);
  assert.equal(esc('"<&>'), "&quot;&lt;&amp;&gt;");
});

test("看板包含目标、赛道、四张图和建议", async () => {
  const db = openStore(":memory:");
  saveSnapshot(db, loadMetricBridge(path.join(FIXTURES, "metricbridge-sample")));
  saveSnapshot(db, await loadAppleExport(path.join(FIXTURES, "apple-export-sample")));
  setRaceGoal(db, { distanceM: 5000, targetSec: 1800, startDate: "2026-09-20", deadline: "2026-11-30" });
  const opts = { now: new Date("2026-09-20T15:00:00Z"), timeZone: "Asia/Shanghai", hrmax: null };
  regeneratePlan(db, buildContext(db, opts));
  const ctx = buildContext(db, { ...opts, now: new Date("2026-10-01T12:00:00Z") });
  const html = renderDashboard(ctx);

  assert.match(html, /<h1>.*5 km 跑进 30:00。<\/h1>/);
  assert.match(html, /目标进度/);
  assert.match(html, /下一次测试/);
  assert.match(html, /aria-label="训练赛道/);
  assert.match(html, /目标测试/);
  assert.equal((html.match(/<svg viewBox="0 0 1200/g) ?? []).length, 4, "赛道 + 成绩 + 心率 + 跑量");
  assert.match(html, /建议/);
  assert.match(html, /数据只保存在本机/);
  // 页面不依赖任何外部资源
  assert.doesNotMatch(html, /<script src=|<link [^>]*href="http/);
});

test("没有目标时给出下一步提示", () => {
  const db = openStore(":memory:");
  const html = renderDashboard(buildContext(db, { now: new Date(), timeZone: "Asia/Shanghai", hrmax: null }));
  assert.match(html, /先定一个目标/);
  assert.match(html, /npm run goal -- set/);
});
