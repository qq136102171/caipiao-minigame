/**
 * 大乐透生成器（均衡覆盖型）
 *
 * 沿用 Flask 项目的 dlt_strategy.py 逻辑：
 *   - 前区：5 个号码（1-35），按 7 个区间固定模板覆盖
 *   - 后区：2 个号码（1-12），按奇偶大小类型轮换
 *   - 输出：4 注 / 期
 */

const { secureSample, secureInt } = require("./random.js");

// 前区 7 个区间
const ZONES = {
  A: [1,2,3,4,5],
  B: [6,7,8,9,10],
  C: [11,12,13,14,15],
  D: [16,17,18,19,20],
  E: [21,22,23,24,25],
  F: [26,27,28,29,30],
  G: [31,32,33,34,35],
};

// 4 注前区的区间覆盖模板（沿用 dlt_strategy.py）
const FRONT_TEMPLATES = [
  ["A", "C", "E", "F", "G"],
  ["B", "D", "E", "F", "G"],
  ["A", "B", "D", "F", "G"],
  ["A", "C", "D", "E", "G"],
];

// 后区类型
const BACK_TYPES = {
  小奇: [1, 3, 5],
  小偶: [2, 4, 6],
  大奇: [7, 9, 11],
  大偶: [8, 10, 12],
};

// 4 注后区类型组合
const BACK_COMBOS = [
  ["小奇", "大偶"],
  ["小奇", "大偶"],
  ["小偶", "大奇"],
  ["小偶", "大奇"],
];

function _genFrontByTemplate(template, lastFronts) {
  // 从模板的每个区间各取一个号码
  // ★v3：尽量排除上期号码（让前区落在 0-1 重合的 84.99% 主流区间）
  const fronts = [];
  for (const zone of template) {
    let pool = ZONES[zone];
    if (lastFronts && lastFronts.length > 0) {
      const filtered = pool.filter(n => !lastFronts.includes(n));
      if (filtered.length > 0) pool = filtered;
    }
    fronts.push(secureChoice(pool));
  }
  return fronts;
}

function _genBackByCombo(combo, lastBacks) {
  // ★v3：全排除上期后区（68.6% 完全不同 + 30% 重 1 个，全排除是概率洼地）
  return combo.map(t => {
    let pool = BACK_TYPES[t];
    if (lastBacks && lastBacks.length > 0) {
      const filtered = pool.filter(n => !lastBacks.includes(n));
      if (filtered.length > 0) pool = filtered;
    }
    return secureChoice(pool);
  });
}

/**
 * 生成一期大乐透 4 注
 */
function generateDLT(lastDraw) {
  // lastDraw = { primary: [front1,front2,...], secondary: [back1,back2] }
  const lastFronts = (lastDraw && lastDraw.primary) || [];
  const lastBacks = (lastDraw && lastDraw.secondary) || [];
  const bets = [];
  for (let i = 0; i < 4; i++) {
    const fronts = _genFrontByTemplate(FRONT_TEMPLATES[i], lastFronts);
    const backs = _genBackByCombo(BACK_COMBOS[i], lastBacks);
    bets.push({
      index: i + 1,
      fronts: fronts.slice().sort((a, c) => a - c),
      backs: backs.slice().sort((a, c) => a - c),
      frontZones: FRONT_TEMPLATES[i],
      backTypes: BACK_COMBOS[i],
      label: `注 ${i + 1}`,
    });
  }
  return {
    lotteryType: "dlt",
    bets,
    structures: [],
    overlapChecks: [],
    totalBets: 4,
    totalCost: 8,   // 4 注 × 2 元（基础价；3 元是追加价，追加需另计）
    allReds: null,
    blueBalls: null,
  };
}

// 内部辅助
function secureChoice(arr) {
  return arr[secureInt(0, arr.length - 1)];
}

module.exports = {
  generateDLT,
  ZONES,
  FRONT_TEMPLATES,
  BACK_TYPES,
  BACK_COMBOS,
};
