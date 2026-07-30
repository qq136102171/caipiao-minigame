/**
 * 历史开奖数据分析（移植自 Python history.py）
 *
 * 功能：
 *   - 加载历史数据
 *   - 计算单号频率 / 出现率 / 热冷号分类
 *   - 对一组号码做命中分析（平均命中数 / 命中分布 / 完全匹配期数）
 */

const ssqHistory = require("../data/ssq_history.js");
const dltHistory = require("../data/dlt_history.js");

const RULES = {
  ssq: {
    primaryRange: rangeArr(1, 33),
    primaryCount: 6,
    primaryLabel: "红球",
    secondaryRange: rangeArr(1, 16),
    secondaryCount: 1,
    secondaryLabel: "蓝球",
  },
  dlt: {
    primaryRange: rangeArr(1, 35),
    primaryCount: 5,
    primaryLabel: "前区",
    secondaryRange: rangeArr(1, 12),
    secondaryCount: 2,
    secondaryLabel: "后区",
  },
};

function rangeArr(from, to) {
  const a = [];
  for (let i = from; i <= to; i++) a.push(i);
  return a;
}

// ===== 数据加载 =====

/**
 * 解析紧凑格式："issue|date|primary|secondary"
 * 返回 [{ issue, date, primary: [n,...], secondary: [n,...] }, ...]
 */
function _parseHistory(lines, kind) {
  const out = [];
  for (const line of lines) {
    if (!line || typeof line !== "string") continue;
    const parts = line.split("|");
    if (parts.length !== 4) continue;
    const [issue, date, pStr, sStr] = parts;
    const primary = pStr.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    let secondary;
    if (kind === "ssq") {
      secondary = [parseInt(sStr.trim(), 10)];
    } else {
      secondary = sStr.split(",").map(s => parseInt(s.trim(), 10));
    }
    if (primary.length === 0 || secondary.length === 0) continue;
    out.push({ issue, date, primary, secondary });
  }
  return out;
}

function loadHistory(kind) {
  const lines = kind === "ssq" ? ssqHistory : dltHistory;
  return _parseHistory(lines, kind);
}

// ===== 单号频率统计 =====

function _frequency(draws, getter) {
  const counter = {};
  for (const d of draws) {
    for (const n of getter(d)) {
      counter[n] = (counter[n] || 0) + 1;
    }
  }
  return counter;
}

function _classifyLevels(stats) {
  if (stats.length === 0) return stats;
  const freqs = [...new Set(stats.map(s => s.frequency))].sort((a, b) => a - b);
  const n = freqs.length;
  let lowThreshold = freqs[0];
  let highThreshold = freqs[n - 1];
  if (n >= 3) {
    lowThreshold = freqs[Math.floor(n / 3) - 1];
    highThreshold = freqs[Math.min(n - 1, Math.floor(2 * n / 3))];
  }
  if (lowThreshold === highThreshold) lowThreshold = highThreshold - 1;
  for (const s of stats) {
    if (s.frequency >= highThreshold && highThreshold > lowThreshold) s.level = "hot";
    else if (s.frequency <= lowThreshold) s.level = "cold";
    else s.level = "warm";
  }
  return stats;
}

function _makeNumberStat(n, freq, total, poolSize) {
  const expectedRate = poolSize / total;
  const rate = total > 0 ? freq / total : 0;
  return { number: n, frequency: freq, rate, expectedRate, deviation: rate - expectedRate, level: "warm" };
}

function computeNumberStats(kind) {
  const draws = loadHistory(kind);
  const rule = RULES[kind];
  const total = Math.max(1, draws.length);

  const primaryCounter = _frequency(draws, d => d.primary);
  const secondaryCounter = _frequency(draws, d => d.secondary);

  const primaryStats = rule.primaryRange.map(n =>
    _makeNumberStat(n, primaryCounter[n] || 0, total, rule.primaryRange.length)
  );
  const secondaryStats = rule.secondaryRange.map(n =>
    _makeNumberStat(n, secondaryCounter[n] || 0, total, rule.secondaryRange.length)
  );

  _classifyLevels(primaryStats);
  _classifyLevels(secondaryStats);

  return { primaryStats, secondaryStats, totalDraws: total };
}

function getTopBottom(kind, n = 5) {
  const { primaryStats, secondaryStats, totalDraws } = computeNumberStats(kind);
  if (totalDraws === 0) {
    return { primaryHot: [], primaryCold: [], secondaryHot: [], secondaryCold: [], totalDraws: 0 };
  }
  const _top = (arr, reverse) =>
    arr.slice().sort((a, b) => reverse ? b.frequency - a.frequency : a.frequency - b.frequency).slice(0, n);
  return {
    primaryHot: _top(primaryStats, true),
    primaryCold: _top(primaryStats, false),
    secondaryHot: _top(secondaryStats, true),
    secondaryCold: _top(secondaryStats, false),
    totalDraws,
  };
}

// ===== 命中分析 =====

function _missingNumberStat(n, poolSize, total) {
  return {
    number: n, frequency: 0, rate: 0,
    expectedRate: total > 0 ? poolSize / total : 0,
    deviation: 0, level: "warm",
  };
}

function analyzeBet(kind, primaryNumbers, secondaryNumbers) {
  const { primaryStats, secondaryStats, totalDraws } = computeNumberStats(kind);
  const draws = loadHistory(kind);
  const rule = RULES[kind];

  const pSet = new Set(primaryNumbers);
  const sSet = new Set(secondaryNumbers);

  const pByNumber = {}; primaryStats.forEach(s => pByNumber[s.number] = s);
  const sByNumber = {}; secondaryStats.forEach(s => sByNumber[s.number] = s);

  let primaryHits = 0;
  let secondaryHits = 0;
  const primaryDist = {};
  const secondaryDist = {};
  const fullMatchIssues = [];

  for (const d of draws) {
    const pHit = d.primary.filter(n => pSet.has(n)).length;
    const sHit = d.secondary.filter(n => sSet.has(n)).length;
    primaryHits += pHit;
    secondaryHits += sHit;
    primaryDist[pHit] = (primaryDist[pHit] || 0) + 1;
    secondaryDist[sHit] = (secondaryDist[sHit] || 0) + 1;
    if (pHit === pSet.size && sHit === sSet.size) {
      fullMatchIssues.push(d.issue);
    }
  }

  const primaryAvg = totalDraws > 0 ? primaryHits / totalDraws : 0;
  const secondaryAvg = totalDraws > 0 ? secondaryHits / totalDraws : 0;

  const pSelected = primaryNumbers.map(n =>
    pByNumber[n] || _missingNumberStat(n, rule.primaryRange.length, totalDraws)
  );
  const sSelected = secondaryNumbers.map(n =>
    sByNumber[n] || _missingNumberStat(n, rule.secondaryRange.length, totalDraws)
  );

  const levelBreakdown = { hot: 0, warm: 0, cold: 0 };
  for (const s of [...pSelected, ...sSelected]) {
    levelBreakdown[s.level] = (levelBreakdown[s.level] || 0) + 1;
  }

  return {
    bet: kind === "ssq"
      ? { reds: primaryNumbers.slice().sort((a, c) => a - c), blue: secondaryNumbers[0] }
      : { fronts: primaryNumbers.slice().sort((a, c) => a - c), backs: secondaryNumbers.slice().sort((a, c) => a - c) },
    totalDraws,
    primaryStats: pSelected,
    secondaryStats: sSelected,
    primaryAvgHits: primaryAvg,
    secondaryAvgHits: secondaryAvg,
    primaryHitDistribution: primaryDist,
    secondaryHitDistribution: secondaryDist,
    fullMatchCount: fullMatchIssues.length,
    fullMatchIssues: fullMatchIssues.slice(0, 10),
    levelBreakdown,
  };
}

// ===== 摘要 =====

function getSummary(kind) {
  const draws = loadHistory(kind);
  if (draws.length === 0) {
    return { lotteryType: kind, totalDraws: 0, earliestIssue: null, latestIssue: null, earliestDate: null, latestDate: null, hasData: false };
  }
  return {
    lotteryType: kind,
    totalDraws: draws.length,
    earliestIssue: draws[0].issue,
    latestIssue: draws[draws.length - 1].issue,
    earliestDate: draws[0].date,
    latestDate: draws[draws.length - 1].date,
    hasData: true,
  };
}

module.exports = {
  loadHistory,
  computeNumberStats,
  getTopBottom,
  analyzeBet,
  getSummary,
  RULES,
};
