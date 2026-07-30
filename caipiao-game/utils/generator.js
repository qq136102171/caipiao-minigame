/**
 * 双色球生成器（原始策略）
 *
 * 注意：已加循环上限 + try-catch + 兜底默认值
 */

const { secureSample, secureInt } = require("./random.js");

const SMALL_RANGE = []; for (let i = 1; i <= 16; i++) SMALL_RANGE.push(i);
const LARGE_RANGE = []; for (let i = 17; i <= 33; i++) LARGE_RANGE.push(i);
const BLUE_RANGE  = []; for (let i = 1; i <= 16; i++) BLUE_RANGE.push(i);

const STRUCTURE_2_4 = [2, 4];
const STRUCTURE_3_3 = [3, 3];
const STRUCTURE_4_2 = [4, 2];
const MAX_OVERLAP = 2;
const MAX_ATTEMPTS = 500;

function _genRedGroup(smallCount, largeCount) {
  const smalls = secureSample(SMALL_RANGE, smallCount);
  const larges = secureSample(LARGE_RANGE, largeCount);
  return new Set([...smalls, ...larges]);
}

function _overlap(a, b) {
  let n = 0;
  a.forEach(v => { if (b.has(v)) n++; });
  return n;
}

function _fallbackGroups() {
  return {
    redA: new Set([1, 2, 17, 18, 19, 20]),
    redB: new Set([3, 4, 5, 21, 22, 23]),
    redC: new Set([6, 7, 8, 9, 24, 25])
  };
}

function generateGroupsOriginal() {
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
    try {
      const a = _genRedGroup(...STRUCTURE_2_4);
      const b = _genRedGroup(...STRUCTURE_3_3);
      const c = _genRedGroup(...STRUCTURE_4_2);
      if (_overlap(a, b) > MAX_OVERLAP) continue;
      if (_overlap(a, c) > MAX_OVERLAP) continue;
      if (_overlap(b, c) > 3) continue;
      return { redA: a, redB: b, redC: c };
    } catch (err) {
      console.error("[generator] error:", err);
      return _fallbackGroups();
    }
  }
  console.warn("[generator] 500 attempts failed, use fallback");
  return _fallbackGroups();
}

function generateBlueBalls() {
  return secureSample(BLUE_RANGE, 6);
}

function makeBetsOriginal(redA, redB, redC, blueBalls) {
  if (blueBalls.length !== 6) throw new Error("需要 6 个互不重复的蓝球");
  const bets = [];
  for (let i = 0; i < 4; i++) bets.push({ reds: new Set(redA), blue: blueBalls[i] });
  bets.push({ reds: new Set(redB), blue: blueBalls[4] });
  bets.push({ reds: new Set(redC), blue: blueBalls[5] });
  return bets;
}

function generateSSQ() {
  const { redA, redB, redC } = generateGroupsOriginal();
  const blues = generateBlueBalls();
  const bets = makeBetsOriginal(redA, redB, redC, blues);
  const allReds = new Set();
  bets.forEach(b => b.reds.forEach(r => allReds.add(r)));
  const labels = ["A 组", "A 组", "A 组", "A 组", "B 组", "C 组"];
  return {
    lotteryType: "ssq",
    bets: bets.map((b, i) => ({
      index: i + 1,
      reds: Array.from(b.reds).sort((a, c) => a - c),
      blue: b.blue,
      label: labels[i],
    })),
    structures: [
      ["A 组（2 小 4 大）", Array.from(redA).sort((a, c) => a - c)],
      ["B 组（3 小 3 大）", Array.from(redB).sort((a, c) => a - c)],
      ["C 组（4 小 2 大）", Array.from(redC).sort((a, c) => a - c)],
    ],
    overlapChecks: [
      { name: "A ∩ B", count: _overlap(redA, redB), limit: MAX_OVERLAP },
      { name: "A ∩ C", count: _overlap(redA, redC), limit: MAX_OVERLAP },
      { name: "B ∩ C", count: _overlap(redB, redC), limit: 3 },
    ],
    totalBets: 6,
    totalCost: 12,
    allReds: Array.from(allReds).sort((a, c) => a - c),
    blueBalls: blues,
  };
}

module.exports = {
  generateSSQ,
  generateGroupsOriginal,
  generateBlueBalls,
  makeBetsOriginal,
  SMALL_RANGE, LARGE_RANGE, BLUE_RANGE,
  MAX_OVERLAP,
};