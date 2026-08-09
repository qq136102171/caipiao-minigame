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

// ===== 期间计算（截止时间逻辑）=====
//
// 彩票规则：
//   SSQ（双色球）：每周日/二/四 21:30 开奖
//                 销售截止：开奖当日 20:00
//   DLT（大乐透）：每周一/三/六 20:30 开奖
//                 销售截止：开奖当日 19:00
//
// 业务规则：
//   截止时间前 → 生成"当期"号码（即下一次开奖的期号）
//   截止时间后 → 生成"下一期"号码（即再下一次开奖的期号）
//   这样确保：保存到彩票库的票，开奖后能正确对照
//
// 期间号规则（每年从 001/0001 重新计）：
//   SSQ: YYYYNNN  (如 2026088)
//   DLT: YYNNN    (如 26086)

const DRAW_RULES = {
  ssq: {
    drawDays: [0, 2, 4],   // 周日(0)、周二(2)、周四(4)
    drawHour: 21,
    drawMin:  30,
    cutoffHour: 20,
    cutoffMin:  0,
  },
  dlt: {
    drawDays: [1, 3, 6],   // 周一(1)、周三(3)、周六(6)
    drawHour: 20,
    drawMin:  30,
    cutoffHour: 19,
    cutoffMin:  0,
  },
};

/**
 * 找下一次开奖日（含今天若今天就是开奖日且未开奖）
 * @returns {Date} 开奖日（时分秒设为开奖时刻）
 */
function _nextDrawDate(lottery, now) {
  const r = DRAW_RULES[lottery];
  const candidate = new Date(now);
  candidate.setHours(r.drawHour, r.drawMin, 0, 0);
  if (r.drawDays.includes(candidate.getDay()) && now < candidate) {
    return candidate;
  }
  // 否则往后 1-7 天找
  for (let i = 1; i <= 7; i++) {
    const d = new Date(candidate);
    d.setDate(candidate.getDate() + i);
    if (r.drawDays.includes(d.getDay())) {
      d.setHours(r.drawHour, r.drawMin, 0, 0);
      return d;
    }
  }
  return null;
}

/**
 * 计算从基准日（含）到目标日（含）之间有多少个"开奖日"
 * 仅在同一年内有效
 */
function _countDrawDaysInYear(lottery, fromDate, toDate) {
  const r = DRAW_RULES[lottery];
  const yearStart = new Date(toDate.getFullYear(), 0, 1);
  let count = 0;
  const cur = new Date(yearStart);
  while (cur <= toDate) {
    if (r.drawDays.includes(cur.getDay())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * 根据当前时间 + 彩票类型 + 历史最新期，计算：
 *   - currentPeriod: "当期"期号（下一个开奖日）
 *   - targetPeriod:  "目标"期号（截止前=当期，截止后=下一期）
 *   - drawDate:      当期开奖日
 *   - targetDate:    目标期开奖日
 *   - isNextPeriod:  是否已过截止（true=生成的票是下一期）
 *   - daysUntilDraw: 距离当期开奖还有几天（0=今天）
 *   - hoursUntilCutoff: 距离当期截止还有几小时（负数=已截止）
 *
 * @param {'ssq'|'dlt'} lottery
 * @param {Date} [now] 不传则用 new Date()
 */
function getCurrentPeriod(lottery, now) {
  if (!now) now = new Date();
  const r = DRAW_RULES[lottery];
  if (!r) {
    return { error: `unknown lottery: ${lottery}` };
  }

  // 1) 找"当期"开奖日（下一次开奖）
  const drawDate = _nextDrawDate(lottery, now);

  // 2) 找"目标"开奖日（截止前=当期，截止后=下一期）
  const cutoff = new Date(drawDate);
  cutoff.setHours(r.cutoffHour, r.cutoffMin, 0, 0);
  let targetDate = drawDate;
  let isNextPeriod = false;
  if (now >= cutoff) {
    isNextPeriod = true;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(drawDate);
      d.setDate(drawDate.getDate() + i);
      if (r.drawDays.includes(d.getDay())) {
        d.setHours(r.drawHour, r.drawMin, 0, 0);
        targetDate = d;
        break;
      }
    }
  }

  // 3) 计算当期 + 目标期号（基于历史最新期 + 推算）
  const draws = loadHistory(lottery);
  const latest = draws[draws.length - 1];
  const latestDate = new Date(latest.date);
  const latestIssue = latest.issue;
  const latestYear = lottery === 'ssq' ? parseInt(latestIssue.slice(0, 4)) : 2000 + parseInt(latestIssue.slice(0, 2));
  const latestNum = lottery === 'ssq' ? parseInt(latestIssue.slice(4)) : parseInt(latestIssue.slice(2));

  function _walk(fromDate, toDate) {
    // 从 fromDate（不含）到 toDate（含）的开奖日数
    const d = new Date(fromDate);
    d.setDate(d.getDate() + 1);
    let n = 0;
    while (d <= toDate) {
      if (r.drawDays.includes(d.getDay())) n++;
      d.setDate(d.getDate() + 1);
    }
    return n;
  }

  function _formatPeriod(year, num) {
    if (lottery === 'ssq') {
      return String(year) + String(num).padStart(3, '0');
    } else {
      return String(year).slice(-2) + String(num).padStart(3, '0');
    }
  }

  function _issueFor(targetD) {
    const tYear = targetD.getFullYear();
    if (tYear === latestYear) {
      const n = _walk(latestDate, targetD);
      return _formatPeriod(tYear, latestNum + n);
    } else {
      // 跨年了：当年从 1 开始
      const n = _countDrawDaysInYear(lottery, latestDate, targetD);
      return _formatPeriod(tYear, n);
    }
  }

  const currentPeriod = _issueFor(drawDate);
  const targetPeriod = _issueFor(targetDate);

  // 4) 倒计时
  const daysUntilDraw = Math.floor((drawDate - now) / 86400000);
  const hoursUntilCutoff = (cutoff - now) / 3600000;

  return {
    lottery,
    lotteryName: lottery === 'ssq' ? '双色球' : '大乐透',
    currentPeriod,    // 当期期号
    targetPeriod,     // 目标期号（截止后=下一期）
    drawDate,         // 当期开奖日
    targetDate,       // 目标期开奖日
    cutoff,           // 当期截止时间
    isNextPeriod,     // 是否已过截止
    isAfterDraw:      now >= drawDate,  // 当期是否已开奖
    daysUntilDraw,
    hoursUntilCutoff,
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
  getCurrentPeriod,
  RULES,
  DRAW_RULES,
};
