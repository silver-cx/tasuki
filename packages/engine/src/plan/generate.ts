// 训练计划生成。
//
// 计划从截止日往前排，按周组织：
//   - 测试周：最后一周是“目标测试”（冲击目标）；再往前每隔 TEST_EVERY 周安排一次全力测试，
//     用真实成绩校准当前水平。测试周减量，测试前只安排轻松跑。
//   - 训练周：每周 1 次质量课（间歇跑和节奏跑交替）、1 次长距离，其余为轻松跑。
//     大部分跑步是轻松强度，少数几次专门练速度。
//   - 跑量：以最近 4 周的平均周跑量为起点，每周增加约 10%；测试周降到约 85%，最后一周约 75%。
//   - 安全上限：任何一周的计划跑量不超过“前 4 周平均”的 RAMP_CAP 倍（与“跑量增长过快”规则一致，
//     计划自己不会触发这条提醒）。超出时先缩短轻松跑，再减少轻松跑的次数——
//     所以每周选 4 天时，第 4 次跑会随着跑量上来逐步加进来。
//   - 测试周最多跑 3 次，测试前一天休息。
//
// 这是一个简单、可解释的规则模板，不是个性化的教练处方。配速和距离都是建议值。

import type { PlannedSession, RaceGoal } from "#schema";
import { addDays, distanceName, fmtDuration, fmtPace, mondayOf } from "../format.ts";

export const TEST_EVERY = 3;
export const WEEKLY_GROWTH = 1.1;
/** 起始周跑量的下限（公里）。最近 4 周跑得很少时（比如中间停过一周），从这里起步。 */
export const MIN_BASE_KM = 12;
/** 每周计划跑量不超过前 4 周平均的这个倍数（“跑量增长过快”规则在 1.3 倍时提醒） */
export const RAMP_CAP = 1.25;
const MIN_EASY_KM = 3;

export interface PlanInput {
  goal: RaceGoal;
  /** 当前在目标距离上的估算成绩（秒），没有数据时为 null */
  currentSec: number | null;
  /** 计划开始前最近 4 周每周的跑量（公里），从早到晚 */
  recentWeeksKm: number[];
  /** 2 区上限心率，用于轻松跑和长距离 */
  easyHrCap: number | null;
  /** 每周跑步的日子，1 = 周一 … 7 = 周日，例如 [2, 4, 6] */
  weekdays: number[];
  /** 计划从哪天开始（含），通常是明天 */
  startDate: string;
}

const round05 = (km: number) => Math.round(km * 2) / 2;
const floor05 = (km: number) => Math.floor(km * 2) / 2;
const WARMUP_KM = 1.5;
const COOLDOWN_KM = 1;

export function generatePlan(input: PlanInput): PlannedSession[] {
  const { goal, weekdays } = input;
  const days = [...new Set(weekdays)].filter((d) => d >= 1 && d <= 7).sort();
  if (days.length === 0) return [];

  const goalKm = goal.distanceM / 1000;
  const goalPace = goal.targetSec / goalKm;
  const currentPace = input.currentSec != null ? input.currentSec / goalKm : goalPace + 30;
  // 间歇用目标配速；目标距离比 5 km 长时，间歇比目标配速快一些
  const intervalPace = goal.distanceM <= 5000 ? goalPace : goalPace - 20;
  // 节奏跑约在当前水平配速上慢 15 秒/公里（接近乳酸阈强度）
  const tempoPace = currentPace + 15;
  const hrText = input.easyHrCap ? `心率不超过 ${input.easyHrCap}，配速不限，必要时走一段` : "能完整说话的强度，配速不限";

  // 1. 列出每周的训练日
  const weeks: string[][] = [];
  for (let monday = mondayOf(input.startDate); monday <= goal.deadline; monday = addDays(monday, 7)) {
    const dates = days
      .map((d) => addDays(monday, d - 1))
      .filter((date) => date >= input.startDate && date <= goal.deadline);
    if (dates.length > 0) weeks.push(dates);
  }
  if (weeks.length === 0) return [];

  // 2. 哪些周是测试周：最后一周，以及从它往前每隔 TEST_EVERY 周
  const last = weeks.length - 1;
  const isTestWeek = (i: number) => (last - i) % TEST_EVERY === 0;

  // 3. 逐周生成
  const out: PlannedSession[] = [];
  const history = [...input.recentWeeksKm];
  const avg4 = () => {
    const last4 = history.slice(-4);
    return last4.length > 0 ? last4.reduce((a, b) => a + b, 0) / last4.length : 0;
  };
  let buildKm = Math.max(avg4(), MIN_BASE_KM);
  let intervalsDone = 0;
  let temposDone = 0;
  let qualityToggle = 0;

  weeks.forEach((dates, i) => {
    const final = i === last;
    if (isTestWeek(i)) {
      const weekKm = buildKm * (final ? 0.75 : 0.85);
      const testDate = dates.at(-1) as string;
      // 测试前一天休息；测试周最多跑 3 次
      const before = dates.slice(0, -1).filter((d) => d !== addDays(testDate, -1)).slice(0, 2);
      const easyKm = before.length > 0 ? Math.max(3, round05((weekKm - goalKm - WARMUP_KM - COOLDOWN_KM) / before.length)) : 0;
      before.forEach((date, j) => {
        out.push({
          date,
          kind: "easy",
          title: j === 0 ? `轻松跑 ${easyKm} km + 4 次加速跑` : `轻松跑 ${easyKm} km`,
          distanceKm: easyKm,
          detail:
            `${hrText}。` +
            (j === 0 ? "结束前做 4 次 20 秒加速跑（逐渐加速到接近全力，走路恢复），唤醒速度。" : "测试前保持轻松，不要加量。"),
          hrCap: input.easyHrCap,
          paceSecPerKm: null,
        });
      });
      out.push({
        date: testDate,
        kind: "test",
        title: final
          ? `目标测试：${distanceName(goal.distanceM)} 冲击 ${fmtDuration(goal.targetSec)}`
          : `测试跑：${distanceName(goal.distanceM)} 全力跑`,
        distanceKm: round05(goalKm + WARMUP_KM + COOLDOWN_KM),
        detail:
          `先慢跑热身 ${WARMUP_KM} km，然后全力跑 ${distanceName(goal.distanceM)}，最后慢跑放松 ${COOLDOWN_KM} km。` +
          `目标配速 ${fmtPace(goalPace)}/km，第 1 公里不要快于它，最后 1 公里再全力。` +
          `热身和放松单独记录，测试的 ${distanceName(goal.distanceM)} 在手表上单独开一次“户外跑步”，这样 Tasuki 才能准确读到成绩。`,
        hrCap: null,
        paceSecPerKm: Math.round(goalPace),
      });
      history.push(easyKm * before.length + round05(goalKm + WARMUP_KM + COOLDOWN_KM));
      return;
    }

    // 训练周
    const weekKm = buildKm;
    const capKm = Math.max(avg4(), MIN_BASE_KM) * RAMP_CAP;
    const quality = dates[0];
    const long = dates.length >= 2 ? dates.at(-1) : null;
    let easy = dates.slice(1, long ? -1 : undefined);
    let qualityKm: number;
    if (qualityToggle % 2 === 0) {
      const reps = Math.min(6, 4 + intervalsDone);
      intervalsDone++;
      qualityKm = round05(WARMUP_KM + reps * 0.8 + (reps - 1) * 0.4 + COOLDOWN_KM);
      out.push({
        date: quality,
        kind: "intervals",
        title: `间歇跑 ${reps} × 800 米`,
        distanceKm: qualityKm,
        detail:
          `慢跑热身 ${WARMUP_KM} km，然后 ${reps} 组 800 米，每组配速 ${fmtPace(intervalPace)}/km（约 ${fmtDuration(intervalPace * 0.8)} 一组），` +
          `组间慢跑或走 400 米恢复；最后慢跑放松 ${COOLDOWN_KM} km。最后一组应该是“还能再跑一组”的状态。`,
        hrCap: null,
        paceSecPerKm: Math.round(intervalPace),
      });
    } else {
      const minutes = Math.min(25, 15 + 5 * temposDone);
      temposDone++;
      qualityKm = round05(WARMUP_KM + (minutes * 60) / tempoPace + COOLDOWN_KM);
      out.push({
        date: quality,
        kind: "tempo",
        title: `节奏跑 ${minutes} 分钟`,
        distanceKm: qualityKm,
        detail:
          `慢跑热身 ${WARMUP_KM} km，然后以 ${fmtPace(tempoPace)}/km 左右连续跑 ${minutes} 分钟——“有点吃力，但还能说几个字”；` +
          `最后慢跑放松 ${COOLDOWN_KM} km。`,
        hrCap: null,
        paceSecPerKm: Math.round(tempoPace),
      });
    }
    qualityToggle++;

    const rest = Math.max(0, weekKm - qualityKm);
    // 长距离至少比目标距离多 1 km，并且是本周最长的轻松跑
    const minLong = goalKm + 1;
    let longKm = long ? Math.max(minLong, round05(easy.length > 0 ? rest * 0.55 : rest)) : 0;
    let easyKm = easy.length > 0 ? Math.max(MIN_EASY_KM, round05((rest - longKm) / easy.length)) : 0;
    // 超过安全上限：先把轻松跑和长距离缩到最短，仍然超出就减少轻松跑的次数（保留靠前的日子）
    const total = () => qualityKm + easyKm * easy.length + longKm;
    if (total() > capKm) {
      if (long) longKm = Math.max(minLong, floor05((capKm - qualityKm) * 0.55));
      // 在上限内尽量多安排几次；每次至少 MIN_EASY_KM，放不下就少一次
      while (easy.length > 0) {
        easyKm = floor05((capKm - qualityKm - longKm) / easy.length);
        if (easyKm >= MIN_EASY_KM) break;
        easy = easy.slice(0, -1);
      }
      if (easy.length === 0) easyKm = 0;
    }
    for (const date of easy) {
      out.push({
        date,
        kind: "easy",
        title: `轻松跑 ${easyKm} km`,
        distanceKm: easyKm,
        detail: `${hrText}。`,
        hrCap: input.easyHrCap,
        paceSecPerKm: null,
      });
    }
    if (long) {
      out.push({
        date: long,
        kind: "long",
        title: `长距离慢跑 ${longKm} km`,
        distanceKm: longKm,
        detail: `${hrText}。这是本周最长的一次，重点是跑完而不是跑快。`,
        hrCap: input.easyHrCap,
        paceSecPerKm: null,
      });
    }
    // 下周在本周实际安排的跑量上增长（每次课有最低距离，实际可能略高于目标）
    const plannedKm = qualityKm + easyKm * easy.length + longKm;
    history.push(plannedKm);
    buildKm = Math.max(buildKm * WEEKLY_GROWTH, plannedKm);
  });

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 一次课的类型名 */
export const KIND_NAMES: Record<PlannedSession["kind"], string> = {
  easy: "轻松跑",
  long: "长距离",
  intervals: "间歇跑",
  tempo: "节奏跑",
  test: "测试跑",
};
