/**
 * 我的彩票库 - 本地存储工具（v2：支持盈亏记录）
 *
 * 数据格式：
 *   library: [
 *     {
 *       id, savedAt, lottery, bets[], totalBets, totalCost, issue,
 *       result: {                  // 开奖结果（待开奖时为 null）
 *         issue:    string,       // 实际开奖期号
 *         date:     string,       // 开奖日期
 *         primary:  number[],     // 开奖号码（前区 / 红球）
 *         secondary: number|number[], // 开奖号码（后区 / 蓝球）
 *         hitLevel: string,       // 最佳命中等级（'一等奖'...'未中奖'）
 *         hitRank:  number,       // 命中等级数字（1=一等, 99=未中奖），便于排序
 *         prizeAmount: number,    // 累计奖金（含所有注）
 *         perBet: [{ index, label, hitLevel, prizeAmount, primaryHit, secondaryHit }],
 *         checkedAt: number,      // 对照时间戳
 *       }
 *     }
 *   ]
 */

const STORAGE_KEY = 'cp_library_v1';

// ===== 中奖判定（SSQ）=====
const SSQ_PRIZES = [
  { rank: 1, name: '一等奖', primaryMatch: 6, secondaryMatch: 1, amount: 0,    note: '浮动(最高1000万)' },
  { rank: 2, name: '二等奖', primaryMatch: 6, secondaryMatch: 0, amount: 0,    note: '约 500万~30万' },
  { rank: 3, name: '三等奖', primaryMatch: 5, secondaryMatch: 1, amount: 3000 },
  { rank: 4, name: '四等奖', primaryMatch: 5, secondaryMatch: 0, amount: 200 },
  { rank: 4, name: '四等奖', primaryMatch: 4, secondaryMatch: 1, amount: 200 },
  { rank: 5, name: '五等奖', primaryMatch: 4, secondaryMatch: 0, amount: 10 },
  { rank: 5, name: '五等奖', primaryMatch: 3, secondaryMatch: 1, amount: 10 },
  { rank: 6, name: '六等奖', primaryMatch: 2, secondaryMatch: 1, amount: 5 },
  { rank: 6, name: '六等奖', primaryMatch: 1, secondaryMatch: 1, amount: 5 },
  { rank: 6, name: '六等奖', primaryMatch: 0, secondaryMatch: 1, amount: 5 },
];
// DLT 中奖规则（精确）
const DLT_PRIZES = [
  { rank: 1, name: '一等奖', primaryMatch: 5, secondaryMatch: 2, amount: 0,    note: '浮动(最高1000万)' },
  { rank: 2, name: '二等奖', primaryMatch: 5, secondaryMatch: 1, amount: 0,    note: '浮动' },
  { rank: 3, name: '三等奖', primaryMatch: 5, secondaryMatch: 0, amount: 10000 },
  { rank: 3, name: '三等奖', primaryMatch: 4, secondaryMatch: 2, amount: 10000 },
  { rank: 4, name: '四等奖', primaryMatch: 4, secondaryMatch: 1, amount: 3000 },
  { rank: 4, name: '四等奖', primaryMatch: 3, secondaryMatch: 2, amount: 3000 },
  { rank: 5, name: '五等奖', primaryMatch: 4, secondaryMatch: 0, amount: 300 },
  { rank: 5, name: '五等奖', primaryMatch: 3, secondaryMatch: 1, amount: 300 },
  { rank: 6, name: '六等奖', primaryMatch: 3, secondaryMatch: 0, amount: 200 },
  { rank: 6, name: '六等奖', primaryMatch: 2, secondaryMatch: 2, amount: 200 },
  { rank: 7, name: '七等奖', primaryMatch: 2, secondaryMatch: 1, amount: 100 },
  { rank: 8, name: '八等奖', primaryMatch: 1, secondaryMatch: 2, amount: 15 },
  { rank: 9, name: '九等奖', primaryMatch: 0, secondaryMatch: 2, amount: 5 },
  { rank: 9, name: '九等奖', primaryMatch: 0, secondaryMatch: 1, amount: 5 },
];

function _hitCount(bet, draw, lottery) {
  // 数命中数
  const bp = bet.primary || [];
  const dp = draw.primary || [];
  const pHit = bp.filter(n => dp.includes(n)).length;
  let sHit = 0;
  if (lottery === 'ssq') {
    const bs = [bet.secondary].flat();
    const ds = draw.secondary;
    sHit = bs.includes(ds) ? 1 : 0;
  } else {
    const bs = (bet.secondary || []).flat();
    const ds = draw.secondary || [];
    sHit = bs.filter(n => ds.includes(n)).length;
  }
  return { pHit, sHit };
}

function _bestMatch(pHit, sHit, lottery) {
  const table = lottery === 'ssq' ? SSQ_PRIZES : DLT_PRIZES;
  // 找最佳（rank 最小）的命中
  let best = null;
  for (const p of table) {
    if (pHit >= p.primaryMatch && sHit >= p.secondaryMatch) {
      if (!best || p.rank < best.rank) best = p;
    }
  }
  return best || { rank: 99, name: '未中奖', amount: 0 };
}

function _read() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(STORAGE_KEY);
      if (Array.isArray(v)) return v;
    }
  } catch (e) {
    console.error('[library] read error', e);
  }
  return [];
}

function _write(list) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(STORAGE_KEY, list);
      return true;
    }
  } catch (e) {
    console.error('[library] write error', e);
  }
  return false;
}

function _genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 列出所有（按 savedAt 倒序）
 */
function list() {
  const arr = _read();
  arr.sort((a, b) => b.savedAt - a.savedAt);
  return arr;
}

/**
 * 保存当前注
 */
function save({ lottery, bets, totalBets, totalCost, issue }) {
  if (!bets || bets.length === 0) return null;
  const arr = _read();
  const item = {
    id: _genId(),
    savedAt: Date.now(),
    lottery,
    bets: bets.map(b => ({
      index: b.index,
      indexPadded: b.indexPadded,
      label: b.label,
      primary: (b.primary || []).map(x => x && x.number != null ? x.number : x),
      secondary: (b.secondary || []).map(x => x && x.number != null ? x.number : x),
    })),
    totalBets: totalBets || bets.length,
    totalCost: totalCost || 0,
    issue: issue || null,
    result: null,  // 初始未开奖
  };
  arr.push(item);
  if (!_write(arr)) return null;
  return item;
}

/**
 * 对照一张票 vs 开奖结果（不写存储，仅计算）
 * draw: { issue, date, primary: [], secondary: number|[n1,n2] }
 */
function checkItem(item, draw) {
  if (!item || !draw) return null;
  const perBet = item.bets.map(bet => {
    const { pHit, sHit } = _hitCount(bet, draw, item.lottery);
    const match = _bestMatch(pHit, sHit, item.lottery);
    return {
      index: bet.index,
      indexPadded: bet.indexPadded,
      label: bet.label,
      primaryHit: pHit,
      secondaryHit: sHit,
      hitLevel: match.name,
      hitRank: match.rank,
      prizeAmount: match.amount,
    };
  });
  // 取所有注中最佳等级
  const bestRank = Math.min(...perBet.map(b => b.hitRank));
  const bestLevel = perBet.find(b => b.hitRank === bestRank).hitLevel;
  const totalPrize = perBet.reduce((s, b) => s + (b.prizeAmount || 0), 0);
  return {
    issue: draw.issue,
    date: draw.date,
    primary: draw.primary,
    secondary: draw.secondary,
    hitLevel: bestLevel,
    hitRank: bestRank,
    prizeAmount: totalPrize,
    perBet,
    checkedAt: Date.now(),
  };
}

/**
 * 把开奖结果写入某张票（持久化）
 */
function markChecked(id, draw) {
  const arr = _read();
  const idx = arr.findIndex(x => x.id === id);
  if (idx < 0) return null;
  const item = arr[idx];
  if (item.result && item.result.issue === draw.issue) {
    // 已经对照过同一期，不重复
    return item;
  }
  const result = checkItem(item, draw);
  if (!result) return null;
  arr[idx].result = result;
  if (_write(arr)) {
    return arr[idx];
  }
  return null;
}

/**
 * 找到所有「待开奖」的票（result 为 null）
 */
function findUnchecked() {
  return _read().filter(x => !x.result);
}

/**
 * 按 lottery 找待开奖
 */
function findUncheckedByLottery(lottery) {
  return _read().filter(x => !x.result && x.lottery === lottery);
}

/**
 * 删除
 */
function remove(id) {
  const arr = _read();
  const idx = arr.findIndex(x => x.id === id);
  if (idx < 0) return false;
  arr.splice(idx, 1);
  return _write(arr);
}

/**
 * 清空
 */
function clear() {
  return _write([]);
}

/**
 * 读取一张
 */
function get(id) {
  return _read().find(x => x.id === id) || null;
}

/**
 * 统计 + 盈亏汇总
 */
function stats() {
  const arr = _read();
  let totalCost = 0;
  let totalPrize = 0;
  let wonCount = 0;     // 中过奖的票数
  let checkedCount = 0; // 已对照过的票数
  for (const x of arr) {
    totalCost += (x.totalCost || 0);
    if (x.result) {
      checkedCount++;
      totalPrize += (x.result.prizeAmount || 0);
      if (x.result.hitRank <= 8) wonCount++;  // 一等~八等都算"中过奖"
    }
  }
  return {
    total: arr.length,
    ssq: arr.filter(x => x.lottery === 'ssq').length,
    dlt: arr.filter(x => x.lottery === 'dlt').length,
    totalCost,         // 累计投入
    totalPrize,        // 累计奖金
    netPnL: totalPrize - totalCost,  // 净盈亏
    wonCount,          // 中奖票数
    checkedCount,      // 已对照票数
    uncheckedCount: arr.length - checkedCount,
  };
}

/**
 * 一键对照所有待开奖票（用某个 drawMap: {ssq: drawObj, dlt: drawObj}）
 * 返回命中的票数 + 总奖金变化
 */
function checkAll(drawMap) {
  const arr = _read();
  let updated = 0;
  let prizeDelta = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (x.result) continue;  // 已对照过
    const draw = drawMap && drawMap[x.lottery];
    if (!draw) continue;
    const result = checkItem(x, draw);
    if (!result) continue;
    arr[i].result = result;
    updated++;
    prizeDelta += result.prizeAmount;
  }
  if (updated > 0) _write(arr);
  return { updated, prizeDelta };
}

module.exports = {
  list,
  save,
  remove,
  clear,
  get,
  stats,
  // v2 新增
  checkItem,
  markChecked,
  findUnchecked,
  findUncheckedByLottery,
  checkAll,
};
