import assert from "node:assert/strict";
import { test } from "node:test";
import type { Activity, PlannedSession, RaceGoal } from "#schema";
import { addDays, isoWeekday, mondayOf } from "#engine/format.ts";
import { assessGoal } from "#engine/goals/progress.ts";
import { generatePlan } from "#engine/plan/generate.ts";
import { matchPlan, qualityActivityIds, testEfforts } from "#engine/plan/match.ts";
import { easyRunHrTooHigh } from "#engine/rules/easyRunHrTooHigh.ts";
import { loadCard } from "#knowledge";
import { loadPlan, openStore, savePlan } from "#store";

const GOAL: RaceGoal = {
  id: 1,
  distanceM: 5000,
  targetSec: 1800,
  startDate: "2026-10-11",
  deadline: "2026-11-30",
};

const plan = () =>
  generatePlan({
    goal: GOAL,
    currentSec: 1935,
    baseWeeklyKm: 10,
    easyHrCap: 134,
    weekdays: [2, 4, 6],
    startDate: "2026-10-12",
  });

function run(id: string, startIso: string, km: number, minutes: number, avgHr: number | null = null): Activity {
  return {
    id,
    source: "test",
    sport: "running",
    rawType: "Running",
    start: startIso,
    durationSec: minutes * 60,
    distanceM: km * 1000,
    avgHr,
    maxHr: null,
    activeKcal: null,
    elevationGainM: null,
    avgPowerW: null,
    strideM: null,
  };
}

test("日期工具", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(isoWeekday("2026-10-11"), 7); // 周日
  assert.equal(mondayOf("2026-10-11"), "2026-10-05");
});

test("计划只排在选定的日子，且不超过截止日", () => {
  const sessions = plan();
  assert.ok(sessions.length > 0);
  for (const s of sessions) {
    assert.ok([2, 4, 6].includes(isoWeekday(s.date)), `${s.date} 不是周二/四/六`);
    assert.ok(s.date >= "2026-10-12" && s.date <= GOAL.deadline);
  }
});

test("测试跑：最后一次课是目标测试，往前每 3 周一次", () => {
  const tests = plan().filter((s) => s.kind === "test");
  assert.deepEqual(
    tests.map((s) => s.date),
    ["2026-10-17", "2026-11-07", "2026-11-28"],
  );
  assert.match(tests.at(-1)?.title ?? "", /目标测试/);
});

test("训练周：1 次质量课（间歇和节奏交替）+ 长距离 + 轻松跑", () => {
  const sessions = plan();
  const week2 = sessions.filter((s) => s.date >= "2026-10-19" && s.date <= "2026-10-25");
  assert.deepEqual(
    week2.map((s) => s.kind),
    ["intervals", "easy", "long"],
  );
  const week3 = sessions.filter((s) => s.date >= "2026-10-26" && s.date <= "2026-11-01");
  assert.equal(week3[0].kind, "tempo");
  // 轻松跑和长距离都有心率上限；间歇用目标配速 6:00/km
  assert.ok(week2.filter((s) => s.kind !== "intervals").every((s) => s.hrCap === 134));
  assert.equal(week2[0].paceSecPerKm, 360);
  // 长距离是本周最长的轻松跑，且至少 6 km
  assert.ok(week2[2].distanceKm >= 6 && week2[2].distanceKm >= week2[1].distanceKm);
});

test("训练周跑量逐周不下降（测试周除外），增幅受控", () => {
  const sessions = plan();
  const byWeek = new Map<string, PlannedSession[]>();
  for (const s of sessions) byWeek.set(mondayOf(s.date), [...(byWeek.get(mondayOf(s.date)) ?? []), s]);
  const training = [...byWeek.values()]
    .filter((w) => !w.some((s) => s.kind === "test"))
    .map((w) => w.reduce((t, s) => t + s.distanceKm, 0));
  for (let i = 1; i < training.length; i++) {
    assert.ok(training[i] >= training[i - 1], `第 ${i + 1} 个训练周跑量下降：${training}`);
    assert.ok(training[i] <= training[i - 1] * 1.25, `第 ${i + 1} 个训练周增幅过大：${training}`);
  }
});

test("测试课和质量课只认同一天", () => {
  const sessions = plan().filter((s) => s.date >= "2026-10-17" && s.date <= "2026-10-20");
  // 周日的轻松跑不能被当成周六的测试；周三的跑步不能被当成周二的间歇
  const acts = [run("sun", "2026-10-18T00:00:00Z", 5, 36, 140), run("wed", "2026-10-21T00:00:00Z", 10, 70, 168)];
  const matches = matchPlan(sessions, acts, GOAL, "2026-10-22", "Asia/Shanghai");
  assert.ok(matches.every((m) => m.activity == null));
});

test("匹配实际跑步：当天优先，轻松跑允许晚一天；测试课选同一天最快的那次", () => {
  const sessions = plan().filter((s) => s.date <= "2026-10-20");
  const acts = [
    run("tue", "2026-10-13T11:00:00Z", 3.1, 22, 130), // 周二晚 19:00（北京时间）
    run("fri", "2026-10-16T00:00:00Z", 3, 21), // 周四的课，周五早上才跑
    run("warm", "2026-10-17T00:00:00Z", 1.5, 11), // 周六热身
    run("tt", "2026-10-17T00:15:00Z", 5.02, 31), // 周六测试
  ];
  const matches = matchPlan(sessions, acts, GOAL, "2026-10-19", "Asia/Shanghai");
  assert.deepEqual(
    matches.map((m) => [m.session.date, m.activity?.id ?? null, m.status]),
    [
      ["2026-10-13", "tue", "done"],
      ["2026-10-15", "fri", "done"],
      ["2026-10-17", "tt", "done"],
      ["2026-10-20", null, "upcoming"],
    ],
  );
  const tests = testEfforts(matches, GOAL);
  assert.equal(tests.length, 1);
  assert.ok(qualityActivityIds(matches).has("tt"));
});

test("有测试成绩后，当前水平用测试成绩", () => {
  const acts = [run("old", "2026-09-21T11:00:00Z", 5, 32.25), run("tt", "2026-10-17T00:15:00Z", 5, 31)];
  const sessions = plan().filter((s) => s.date <= "2026-10-17");
  const matches = matchPlan(sessions, acts, GOAL, "2026-10-18", "Asia/Shanghai");
  const p = assessGoal(GOAL, acts, new Date("2026-10-18T12:00:00Z"), testEfforts(matches, GOAL));
  assert.equal(p.basis, "test");
  assert.equal(p.current?.activity.id, "tt");
  assert.equal(p.gapSec, 60);
});

test("两次测试之间算进步速度", () => {
  const acts = [run("t1", "2026-10-17T00:15:00Z", 5, 32), run("t2", "2026-11-07T00:15:00Z", 5, 31)];
  const sessions = plan().filter((s) => s.date <= "2026-11-07");
  const matches = matchPlan(sessions, acts, GOAL, "2026-11-08", "Asia/Shanghai");
  const p = assessGoal(GOAL, acts, new Date("2026-11-08T12:00:00Z"), testEfforts(matches, GOAL));
  assert.equal(Math.round(p.ratePerWeek ?? 0), 20); // 3 周快了 60 秒
});

test("轻松跑心率规则排除计划里的质量课", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const acts = [run("easy", "2026-10-13T11:00:00Z", 3, 22, 130), run("tt", "2026-10-17T00:15:00Z", 5, 31, 180)];
  const base = { activities: acts, hrMax: 192, now, timeZone: "Asia/Shanghai" };
  assert.ok(easyRunHrTooHigh.run(base), "没有计划时，测试跑也会被算进去");
  assert.equal(easyRunHrTooHigh.run({ ...base, qualityActivityIds: new Set(["tt"]) }), null);
});

test("计划存取：重新生成只替换未来的课", () => {
  const db = openStore(":memory:");
  savePlan(db, plan(), "2026-10-12", 1);
  const before = loadPlan(db).length;
  savePlan(db, plan().filter((s) => s.date >= "2026-11-01"), "2026-11-01", 1);
  assert.equal(loadPlan(db).length, before);
  savePlan(db, [], "2026-11-01", 1);
  assert.ok(loadPlan(db).every((s) => s.date < "2026-11-01"));
});

test("测试跑知识卡存在", () => {
  assert.ok(loadCard("time-trial"));
});
