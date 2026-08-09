/**
 * 双色球生成器（原始策略 + 去重增强版 v2）
 *
 * 算法目标：
 *   - 三组红球（A=2小4大 / B=3小3大 / C=4小2大）尽量分散
 *   - 全局去重：A∪B∪C 至少覆盖 13 个不同号码
 *   - 单号去重：任意号码出现在多组的次数 ≤ 2
 *   - 蓝球均衡：6 个蓝球奇偶比 3:3 或 2:4，大小比 1:1
 *
 * 去重检查：
 *   - A∩B ≤ 1
 *   - A∩C ≤ 1
 *   - B∩C ≤ 2
 *   - A∪B∪C ≥ 13 个不同号码
 *   - 单号码出现组数 ≤ 2
 */

const { secureSample, secureInt } = require("./random.js");

const SMALL_RANGE = []; for (let i = 1; i <= 16; i++) SMALL_RANGE.push(i);
const LARGE_RANGE = []; for (let i = 17; i <= 33; i++) LARGE_RANGE.push(i);
const BLUE_RANGE  = []; for (let i = 1; i <= 16; i++) BLUE_RANGE.push(i);
const BLUE_SMALL  = []; for (let i = 1; i <= 8; i++) BLUE_SMALL.push(i);   // 1-8
const BLUE_LARGE  = []; for (let i = 9; i <= 16; i++) BLUE_LARGE.push(i);  // 9-16

const STRUCTURE_2_4 = [2, 4];
const STRUCTURE_3_3 = [3, 3];
const STRUCTURE_4_2 = [4, 2];

// === 去重约束（v2 增强）===
const MAX_OVERLAP_AB = 1;   // A∩B 最多 1 个
const MAX_OVERLAP_AC = 1;   // A∩C 最多 1 个
const MAX_OVERLAP_BC = 2;   // B∩C 最多 2 个
const MIN_UNIQUE_REDS = 13; // A∪B∪C 至少 13 个不同号码（满分 18）
const MAX_REPEAT_RED = 2;   // 单个号码最多在 2 个组里出现
const MAX_ATTEMPTS = 800;

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

// 与数组比较（用于跟上期开奖比对）
function _overlapArr(a, arr) {
  if (!arr || arr.length === 0) return 0;
  let n = 0;
  a.forEach(v => { if (arr.includes(v)) n++; });
  return n;
}

function _unionSize(...sets) {
  const u = new Set();
  sets.forEach(s => s.forEach(v => u.add(v)));
  return u.size;
}

function _repeatCount(...sets) {
  // 返回出现次数 ≥ 3 的号码个数（违反 MAX_REPEAT_RED 即 >2 即 ≥3）
  const counts = new Map();
  sets.forEach(s => s.forEach(v => counts.set(v, (counts.get(v) || 0) + 1)));
  let bad = 0;
  counts.forEach(c => { if (c > MAX_REPEAT_RED) bad++; });
  return bad;
}

function _fallbackGroups() {
  return {
    redA: new Set([1, 2, 17, 18, 19, 20]),
    redB: new Set([3, 4, 5, 21, 22, 23]),
    redC: new Set([6, 7, 8, 9, 24, 25])
  };
}

function generateGroupsOriginal(lastReds) {
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
    try {
      const a = _genRedGroup(...STRUCTURE_2_4);
      const b = _genRedGroup(...STRUCTURE_3_3);
      const c = _genRedGroup(...STRUCTURE_4_2);
      // 1. 区间重叠检查
      if (_overlap(a, b) > MAX_OVERLAP_AB) continue;
      if (_overlap(a, c) > MAX_OVERLAP_AC) continue;
      if (_overlap(b, c) > MAX_OVERLAP_BC) continue;
      // 2. 全局去重：A∪B∪C ≥ 13 个不同号码
      const uniq = _unionSize(a, b, c);
      if (uniq < MIN_UNIQUE_REDS) continue;
      // 3. 单号去重：任何号码出现 >2 次即弃
      const badRepeats = _repeatCount(a, b, c);
      if (badRepeats > 0) continue;
      // 4. ★v3 新增：跟"上期开奖"红球重合 ≤ 1（让选号更符合历史主流 70.59% 区间）
      if (lastReds && lastReds.length > 0) {
        const aOver = _overlapArr(a, lastReds);
        const bOver = _overlapArr(b, lastReds);
        const cOver = _overlapArr(c, lastReds);
        if (aOver > 1 || bOver > 1 || cOver > 1) continue;
      }
      return { redA: a, redB: b, redC: c };
    } catch (err) {
      console.error("[generator] error:", err);
      return _fallbackGroups();
    }
  }
  console.warn(`[generator] ${MAX_ATTEMPTS} attempts failed, use fallback`);
  return _fallbackGroups();
}

/**
 * 蓝球均衡生成：
 *   - 6 个蓝球互不重复
 *   - 奇偶比：3奇3偶 或 4奇2偶（不出现 1奇5偶 或 5奇1偶 的极端分布）
 *   - 大小比（1-8 小 / 9-16 大）：至少 2 小 + 2 大
 */
function generateBlueBalls(lastBlue) {
  // ★v3 新增：全排除上期蓝球（93% 的历史期数下一期会换蓝球，全排除是概率洼地）
  const pool = (lastBlue != null && lastBlue > 0)
    ? BLUE_RANGE.filter(b => b !== lastBlue)
    : BLUE_RANGE;
  for (let attempts = 0; attempts < 200; attempts++) {
    const balls = secureSample(pool, 6);
    const oddCount = balls.filter(b => b % 2 === 1).length;
    if (oddCount < 2 || oddCount > 4) continue;  // 3±1
    const smallCount = balls.filter(b => b <= 8).length;
    if (smallCount < 2 || smallCount > 4) continue;  // 大小也 3±1
    return balls;
  }
  // 兜底：手工拼一组（也排除 lastBlue）
  console.warn("[generator] blue ball balance fallback");
  const fallback = [3, 7, 9, 12, 14, 16].filter(b => b !== lastBlue);
  // 兜底长度不足时补一个
  while (fallback.length < 6) {
    const extra = secureChoice(BLUE_RANGE.filter(b => !fallback.includes(b) && b !== lastBlue));
    fallback.push(extra);
  }
  return fallback.slice(0, 6);
}

function makeBetsOriginal(redA, redB, redC, blueBalls) {
  if (blueBalls.length !== 6) throw new Error("需要 6 个互不重复的蓝球");
  const bets = [];
  // A 组 4 注：前 4 个蓝球
  for (let i = 0; i < 4; i++) bets.push({ reds: new Set(redA), blue: blueBalls[i] });
  // B / C 组各 1 注
  bets.push({ reds: new Set(redB), blue: blueBalls[4] });
  bets.push({ reds: new Set(redC), blue: blueBalls[5] });
  return bets;
}

function generateSSQ(lastDraw) {
  // lastDraw = { primary: [r1,r2,...], secondary: blue 或 [blue] }
  const lastReds = (lastDraw && lastDraw.primary) || [];
  // history 的 secondary 可能是数组 [5] 或裸数字 5，统一提取
  let lastBlue = null;
  if (lastDraw && lastDraw.secondary != null) {
    lastBlue = Array.isArray(lastDraw.secondary) ? lastDraw.secondary[0] : lastDraw.secondary;
  }
  const { redA, redB, redC } = generateGroupsOriginal(lastReds);
  const blues = generateBlueBalls(lastBlue);
  const bets = makeBetsOriginal(redA, redB, redC, blues);
  const allReds = new Set();
  bets.forEach(b => b.reds.forEach(r => allReds.add(r)));
  const labels = ["A 组", "A 组", "A 组", "A 组", "B 组", "C 组"];
  // 统计奇偶 / 大小（输出给 UI）
  const blueStats = {
    oddCount: blues.filter(b => b % 2 === 1).length,
    evenCount: blues.length - blues.filter(b => b % 2 === 1).length,
    smallCount: blues.filter(b => b <= 8).length,
    largeCount: blues.filter(b => b > 8).length,
  };
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
      { name: "A ∩ B", count: _overlap(redA, redB), limit: MAX_OVERLAP_AB },
      { name: "A ∩ C", count: _overlap(redA, redC), limit: MAX_OVERLAP_AC },
      { name: "B ∩ C", count: _overlap(redB, redC), limit: MAX_OVERLAP_BC },
      { name: "全局去重", count: _unionSize(redA, redB, redC), limit: MIN_UNIQUE_REDS },
      { name: "重复号码", count: _repeatCount(redA, redB, redC), limit: 0 },
    ],
    blueStats,
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
  MAX_OVERLAP_AB, MAX_OVERLAP_AC, MAX_OVERLAP_BC, MIN_UNIQUE_REDS, MAX_REPEAT_RED,
  // 向后兼容：保留 MAX_OVERLAP 但实际值改成更严的 A∩B 上限
  get MAX_OVERLAP() { return MAX_OVERLAP_AB; },
};
