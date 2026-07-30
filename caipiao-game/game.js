/**
 * 彩票投注方案生成器 - 微信小游戏
 *
 * 入口：wx.createCanvas() + requestAnimationFrame() 主循环
 * 渲染：Canvas 2D 完整复刻原小程序的票面/号码球/历史分析/热冷号
 * 业务：直接复用 utils/generator.js + utils/dlt.js + utils/history.js
 */

const { generateSSQ } = require('./utils/generator.js');
const { generateDLT } = require('./utils/dlt.js');
const { analyzeBet, getSummary, getTopBottom } = require('./utils/history.js');

// ===== 状态 =====
const state = {
  lottery: 'ssq',
  generating: false,
  currentBets: [],
  structures: [],
  overlapChecks: [],
  totalBets: 0,
  totalCost: 0,
  historyAnalysis: { per_bet: [] },
  historySummary: { totalDraws: 0, hasData: false },
  hotcoldRows: [],
  currentTime: '--:--',
  scrollY: 0,
  pressedBtn: null,
  touchStartY: 0,
  touchLastY: 0,
  touchStartScroll: 0,
  touchStartTime: 0,
  scrollVelocity: 0,   // px/ms，手指抬起后用此值做惯性
  scrollMin: 0,       // 动态边界
  scrollMax: 0,
};

// ===== 工具 =====
function pad(n) { return String(n).padStart(2, '0'); }
function pct(rate) { return (rate * 100).toFixed(1) + '%'; }
function levelColor(level) {
  if (level === 'hot') return '#e60012';
  if (level === 'cold') return '#1976d2';
  return '#ff8a00';
}
function formatDist(dist) {
  if (!dist || Object.keys(dist).length === 0) return '—';
  const keys = Object.keys(dist).map(Number).sort((a, b) => a - b);
  return keys.map(k => `${k}中${dist[k]}`).join(' · ');
}
function ballForRender(num, stat) {
  return {
    number: num,
    padded: pad(num),
    color: levelColor(stat ? stat.level : 'warm'),
    freq: stat ? stat.frequency : 0,
    pct: stat ? pct(stat.rate) : '',
  };
}
function betForRender(bet, analysis, lottery) {
  const primary = lottery === 'ssq' ? bet.reds : bet.fronts;
  const secondary = lottery === 'ssq' ? [bet.blue] : bet.backs;
  const pStat = {}; (analysis.primaryStats || []).forEach(s => pStat[s.number] = s);
  const sStat = {}; (analysis.secondaryStats || []).forEach(s => sStat[s.number] = s);
  return {
    index: bet.index,
    indexPadded: pad(bet.index),
    label: bet.label,
    primary: primary.map(n => ballForRender(n, pStat[n])),
    secondary: secondary.map(n => ballForRender(n, sStat[n])),
  };
}
function analysisForRender(analysis) {
  return {
    primaryAvg: analysis.primaryAvgHits.toFixed(2),
    secondaryAvg: analysis.secondaryAvgHits.toFixed(2),
    levelBreakdown: analysis.levelBreakdown,
    fullMatchCount: analysis.fullMatchCount,
    primaryHitDistStr: formatDist(analysis.primaryHitDistribution),
    secondaryHitDistStr: formatDist(analysis.secondaryHitDistribution),
  };
}

function generate() {
  state.generating = true;
  try {
    const kind = state.lottery;
    const result = kind === 'ssq' ? generateSSQ() : generateDLT();
    const summary = getSummary(kind);
    const perBet = result.bets.map(bet => {
      const primary = kind === 'ssq' ? bet.reds : bet.fronts;
      const secondary = kind === 'ssq' ? [bet.blue] : bet.backs;
      const analysis = analyzeBet(kind, primary, secondary);
      return {
        bet: betForRender(bet, analysis, kind),
        analysis: analysisForRender(analysis),
      };
    });
    const tb = getTopBottom(kind, 5);
    state.hotcoldRows = [
      { key: 'p_hot', label: kind === 'ssq' ? '红球 热号' : '前区 热号', emoji: '🔥', kind: 'hot',
        items: tb.primaryHot.map(s => ({ number: s.number, padded: pad(s.number), frequency: s.frequency, color: '#e60012' })) },
      { key: 'p_cold', label: kind === 'ssq' ? '红球 冷号' : '前区 冷号', emoji: '❄️', kind: 'cold',
        items: tb.primaryCold.map(s => ({ number: s.number, padded: pad(s.number), frequency: s.frequency, color: '#1976d2' })) },
      { key: 's_hot', label: kind === 'ssq' ? '蓝球 热号' : '后区 热号', emoji: '🔥', kind: 'hot',
        items: tb.secondaryHot.map(s => ({ number: s.number, padded: pad(s.number), frequency: s.frequency, color: '#e60012' })) },
      { key: 's_cold', label: kind === 'ssq' ? '蓝球 冷号' : '后区 冷号', emoji: '❄️', kind: 'cold',
        items: tb.secondaryCold.map(s => ({ number: s.number, padded: pad(s.number), frequency: s.frequency, color: '#1976d2' })) },
    ];
    state.currentBets = perBet.map(p => p.bet);
    state.structures = result.structures.map(([name, nums]) => ({ name, numsStr: nums.map(pad).join(' ') }));
    state.overlapChecks = result.overlapChecks;
    state.totalBets = result.totalBets;
    state.totalCost = result.totalCost;
    state.historyAnalysis = { per_bet: perBet.map(p => p.analysis) };
    state.historySummary = summary;
  } catch (err) {
    console.error('生成失败:', err);
  } finally {
    state.generating = false;
    markDirty();
  }
}

function updateTime() {
  const d = new Date();
  state.currentTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  markDirty();
}

// ===== 画布 =====
let canvas, ctx, dpr, W = 0, H = 0;

function initCanvas() {
  canvas = wx.createCanvas();
  const sys = wx.getSystemInfoSync();
  dpr = sys.pixelRatio || 1;
  W = sys.windowWidth;
  H = sys.windowHeight;
  // 固定 NAV_BAR_H = 60 (iPhone 灵动岛 + 状态栏 全部安全区) + 22 (status 副条) = 82
  // 不用 safeArea.top 是因为小游戏在某些 iOS 版本里 safeArea.top 返回 0
  NAV_BAR_H = 82;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
}

function colorByLottery(lottery) {
  return lottery === 'ssq' ? '#e60012' : '#ff6f00';
}

function roundedRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function fillRound(x, y, w, h, r, color) {
  ctx.fillStyle = color;
  roundedRectPath(x, y, w, h, r);
  ctx.fill();
}

function text(s, x, y, opts) {
  const o = opts || {};
  ctx.fillStyle = o.color || '#222';
  ctx.font = `${o.weight || 'normal'} ${o.size || 14}px sans-serif`;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'top';
  ctx.fillText(s, x, y);
}

function inRect(x, y, rx, ry, rw, rh) {
  return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
}

// ===== 几何常量 =====
const PAD = 12;
let NAV_BAR_H = 40;
const STATUS_H = 22;
const HEADER_H = 56;          // 票面顶部红色条
const SECTION_GAP = 8;        // 区之间间隔
const BALL_SIZE = 24;         // 主球
const MINI_BALL = 20;         // 紧凑球
const LINE = 16;              // 单行 16px

// 区域 y 坐标（计算一次，draw 时按这些值画）
let layoutY; // 当前累加 y

function drawNavBar() {
  // 状态栏区域：顶部 0 ~ SAFE_TOP 用深色背景
  ctx.fillStyle = colorByLottery(state.lottery);
  ctx.fillRect(0, 0, W, NAV_BAR_H);
  // 标题和时间放在状态栏 + 灵动岛安全区下方（y = SAFE_TOP + 4）
  // 不再依赖 safeArea 动态值，使用固定的 SAFE_TOP=60（适配 iPhone 灵动岛 + 状态栏）
  const SAFE_TOP = 60;
  const titleCx = W / 2;
  text('彩票投注方案生成器', titleCx, SAFE_TOP + 4, { size: 16, weight: 'bold', color: '#fff', align: 'center' });
  text(state.currentTime, W - PAD - 6, SAFE_TOP + 6, { size: 12, color: 'rgba(255,255,255,0.85)', align: 'right' });
  // 状态条
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, NAV_BAR_H, W, STATUS_H);
  text(`📚 历史样本 ${state.historySummary.totalDraws || 0} 期`, PAD, NAV_BAR_H + 4, { size: 12, color: '#666' });
}

function drawTicketCard() {
  // 整张白色票面（contentY 开始, 高度在 layoutY 已算好）
  const tx = PAD, ty = layoutY.startY;
  const tw = W - PAD * 2;
  const th = layoutY.ticketH;
  fillRound(tx, ty, tw, th, 10, '#fff');
  // 红色顶部
  fillRound(tx, ty, tw, HEADER_H, 10, colorByLottery(state.lottery));
  ctx.fillStyle = '#fff';
  ctx.fillRect(tx, ty + HEADER_H - 8, tw, 8);
  text(state.lottery === 'ssq' ? '双色球' : '大乐透', tx + 14, ty + 16, { size: 18, weight: 'bold', color: '#fff' });
  const issueText = state.historySummary.latestIssue ? `第 ${state.historySummary.latestIssue} 期` : '样本';
  text(issueText, tx + tw - 14, ty + 18, { size: 12, color: 'rgba(255,255,255,0.9)', align: 'right' });

  // 操作区
  let y = ty + HEADER_H + 14;
  // 彩种切换
  text('选择彩种', tx + 14, y, { size: 12, color: '#666' });
  y += 20;
  const innerW = tw - 28;
  const btnW = (innerW - 10) / 2;
  const btnH = 32;
  drawLotteryButton('ssq', '双色球', tx + 14, y, btnW, btnH);
  drawLotteryButton('dlt', '大乐透', tx + 14 + btnW + 10, y, btnW, btnH);
  layoutY.tabY = y;
  y += btnH + 12;

  if (state.lottery === 'ssq') {
    text('投注策略', tx + 14, y, { size: 12, color: '#666' });
    text('原始策略（4+2）', tx + 80, y, { size: 12, color: '#333' });
    y += 20;
  }
  // 生成按钮
  drawGenerateButton(tx + 14, y, tw - 28, 44);
  layoutY.genBtnY = y;
  layoutY.genBtnH = 44;
  y += 44 + 16;  // 加 16px 间距，避免误触
  // 导出按钮（独立行，醒目）
  drawExportButton(tx + 14, y, tw - 28, 44);
  layoutY.exportBtnX = tx + 14;
  layoutY.exportBtnY = y;
  layoutY.exportBtnW = tw - 28;
  layoutY.exportBtnH = 44;
  y += 44 + 14;

  // 投注列表标题
  text('本期投注', tx + 14, y, { size: 12, color: '#666' });
  y += 20;

  if (state.currentBets.length === 0) {
    fillRound(tx + 14, y, tw - 28, 40, 6, '#f9f9f9');
    text('点击上方按钮生成投注号码', tx + 14 + (tw - 28) / 2, y + 12, { size: 12, color: '#999', align: 'center' });
    y += 40;
  } else {
    for (let i = 0; i < state.currentBets.length; i++) {
      y = drawBetRow(state.currentBets[i], state.historyAnalysis.per_bet[i], y, tx, tw);
      y += 8;
    }
  }

  // 底部摘要
  y += 4;
  ctx.save();
  ctx.strokeStyle = '#eee';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(tx + 14, y); ctx.lineTo(tx + tw - 14, y); ctx.stroke();
  ctx.restore();
  y += 10;
  text(`${state.totalBets} 注`, tx + 14, y, { size: 14, weight: 'bold', color: colorByLottery(state.lottery) });
  text(`${state.totalCost} 元`, tx + 80, y, { size: 14, weight: 'bold', color: colorByLottery(state.lottery) });
  // 二维码占位
  const qrSize = 48;
  const qrX = tx + tw - qrSize - 14;
  const qrY = y - 6;
  ctx.fillStyle = '#fff';
  ctx.fillRect(qrX, qrY, qrSize, qrSize);
  ctx.fillStyle = '#333';
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    if ((r * 3 + c + (r * c)) % 3 === 0) ctx.fillRect(qrX + 4 + c * 6, qrY + 4 + r * 6, 5, 5);
  }
  y += Math.max(qrSize, 24) + 8;
  text('中国福利彩票', tx + tw / 2, y, { size: 10, color: '#999', align: 'center' });
  y += 16;
}

function drawLotteryButton(kind, label, x, y, w, h) {
  const active = state.lottery === kind;
  fillRound(x, y, w, h, 6, active ? colorByLottery(state.lottery) : '#f5f5f5');
  text(label, x + w / 2, y + (h - 14) / 2, { size: 13, weight: active ? 'bold' : 'normal', color: active ? '#fff' : '#333', align: 'center' });
}

function drawGenerateButton(x, y, w, h) {
  const pressed = state.pressedBtn && state.pressedBtn.kind === 'generate';
  fillRound(x, y, w, h, 8, pressed ? '#c00010' : colorByLottery(state.lottery));
  const icon = state.generating ? '⏳' : '🎱';
  const label = state.generating ? '生成中...' : '生成一注';
  text(icon, x + 14, y + (h - 18) / 2, { size: 18 });
  text(label, x + w / 2 + 4, y + (h - 16) / 2, { size: 14, weight: 'bold', color: '#fff', align: 'center' });
}

function drawExportButton(x, y, w, h) {
  const pressed = state.pressedBtn && state.pressedBtn.kind === 'export';
  fillRound(x, y, w, h, 8, pressed ? '#4caf50' : '#fff');
  ctx.strokeStyle = pressed ? '#4caf50' : colorByLottery(state.lottery);
  ctx.lineWidth = 1.5;
  roundedRectPath(x + 0.75, y + 0.75, w - 1.5, h - 1.5, 7.25);
  ctx.stroke();
  // 居中：icon + 文字
  text('📷  导出彩票图片到相册', x + w / 2, y + (h - 14) / 2, { size: 14, weight: 'bold', color: colorByLottery(state.lottery), align: 'center' });
}

function drawBetRow(bet, analysis, y, tx, tw) {
  const x = tx + 14;
  const w = tw - 28;
  const h = 86;
  fillRound(x, y, w, h, 8, '#fafafa');
  // 序号
  fillRound(x + 8, y + 8, 26, 26, 4, colorByLottery(state.lottery));
  text(bet.indexPadded, x + 8 + 13, y + 8 + 6, { size: 12, weight: 'bold', color: '#fff', align: 'center' });
  text(bet.label, x + 8 + 13, y + 38, { size: 10, color: '#666', align: 'center' });
  // 球
  const primary = bet.primary;
  const secondary = bet.secondary;
  const ballStartX = x + 44;
  const ballSize = 22;
  const ballGap = 4;
  for (let i = 0; i < primary.length; i++) {
    drawBall(ballStartX + i * (ballSize + ballGap), y + 10, ballSize, primary[i]);
  }
  const sepX = ballStartX + primary.length * (ballSize + ballGap) + 4;
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sepX, y + 12); ctx.lineTo(sepX, y + 36); ctx.stroke();
  for (let i = 0; i < secondary.length; i++) {
    drawBall(sepX + 6 + i * (ballSize + ballGap), y + 10, ballSize, secondary[i], '#1976d2');
  }
  // 命中信息
  const ty2 = y + 46;
  text(`${state.lottery === 'ssq' ? '红球' : '前区'}均命中 ${analysis.primaryAvg}`, x + 8, ty2, { size: 10, color: '#666' });
  text(`${state.lottery === 'ssq' ? '蓝球' : '后区'}均命中 ${analysis.secondaryAvg}`, x + w / 2, ty2, { size: 10, color: '#666' });
  text(`热${analysis.levelBreakdown.hot||0}`, x + 8, ty2 + 16, { size: 10, color: '#e60012' });
  text(`温${analysis.levelBreakdown.warm||0}`, x + 38, ty2 + 16, { size: 10, color: '#ff8a00' });
  text(`冷${analysis.levelBreakdown.cold||0}`, x + 68, ty2 + 16, { size: 10, color: '#1976d2' });
  return y + h;
}

const _ballGradCache = new Map();
function _getBallGrad(color, size) {
  const key = color + ':' + size;
  let g = _ballGradCache.get(key);
  if (g) return g;
  g = ctx.createRadialGradient(0, 0, 1, 0, 0, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  _ballGradCache.set(key, g);
  return g;
}
function drawBall(x, y, size, ball, fallbackColor) {
  const c = ball.color || fallbackColor || '#e60012';
  // 实心球
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  // 高光（一次性 createRadialGradient，按 (color, size) 缓存复用）
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.fillStyle = _getBallGrad(c, size);
  ctx.beginPath();
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  text(ball.padded, x + size / 2, y + size / 2 - 7, { size: 11, weight: 'bold', color: '#fff', align: 'center' });
  if (ball.freq) {
    text(String(ball.freq), x + size / 2, y + size - 5, { size: 7, color: 'rgba(255,255,255,0.85)', align: 'center' });
  }
}

function drawStructures(y) {
  if (state.lottery !== 'ssq') return y;
  const h = 20 + state.structures.length * 16 + 10;
  fillRound(PAD, y, W - PAD * 2, h, 8, '#fff');
  text('📊 号码结构', PAD + 12, y + 8, { size: 12, weight: 'bold', color: '#222' });
  let ty = y + 28;
  for (const s of state.structures) {
    text(s.name, PAD + 12, ty, { size: 10, color: '#666' });
    text(s.numsStr, PAD + W - PAD * 2 - 12, ty, { size: 10, color: '#333', align: 'right' });
    ty += 16;
  }
  return y + h;
}

function drawOverlap(y) {
  if (state.lottery !== 'ssq') return y;
  const h = 20 + state.overlapChecks.length * 16 + 10;
  fillRound(PAD, y, W - PAD * 2, h, 8, '#fff');
  text('重叠检查', PAD + 12, y + 8, { size: 12, weight: 'bold', color: '#222' });
  let ty = y + 28;
  for (const c of state.overlapChecks) {
    const ok = c.count <= c.limit;
    text(`${c.name}（限≤${c.limit}）`, PAD + 12, ty, { size: 10, color: '#666' });
    text(`${c.count} 个`, PAD + W - PAD * 2 - 12, ty, { size: 10, weight: 'bold', color: ok ? '#4caf50' : '#e60012', align: 'right' });
    ty += 16;
  }
  return y + h;
}

function drawHistoryPanel(y) {
  const total = state.historySummary.totalDraws || 0;
  if (!state.historySummary.hasData) {
    fillRound(PAD, y, W - PAD * 2, 50, 8, '#fff');
    text('📊 历史命中分析', PAD + 12, y + 8, { size: 12, weight: 'bold', color: '#222' });
    text('暂无历史数据', PAD + 12, y + 28, { size: 10, color: '#999' });
    return y + 50;
  }
  const hasBets = state.currentBets.length > 0;
  const cardH = hasBets ? state.currentBets.length * 70 + 8 : 0;
  const h = 36 + cardH + 10;
  fillRound(PAD, y, W - PAD * 2, h, 8, '#fff');
  text('📊 历史命中分析', PAD + 12, y + 8, { size: 12, weight: 'bold', color: '#222' });
  text(`共 ${total} 期（${state.historySummary.earliestIssue} → ${state.historySummary.latestIssue}）`, PAD + 12, y + 24, { size: 10, color: '#999' });
  let ty = y + 40;
  if (hasBets) {
    for (let i = 0; i < state.currentBets.length; i++) {
      const bet = state.currentBets[i];
      const ha = state.historyAnalysis.per_bet[i];
      if (!ha) continue;
      fillRound(PAD + 6, ty, W - PAD * 2 - 12, 64, 6, '#fafafa');
      text(`${bet.label} · 历史命中分析`, PAD + 14, ty + 6, { size: 10, weight: 'bold', color: '#333' });
      text(`${state.lottery === 'ssq' ? '红球' : '前区'}均 ${ha.primaryAvg} 个/期`, PAD + 14, ty + 22, { size: 9, color: '#666' });
      text(`${state.lottery === 'ssq' ? '蓝球' : '后区'}均 ${ha.secondaryAvg} 个/期`, PAD + 14, ty + 36, { size: 9, color: '#666' });
      text(`热${ha.levelBreakdown.hot||0}`, PAD + 14, ty + 50, { size: 9, color: '#e60012' });
      text(`温${ha.levelBreakdown.warm||0}`, PAD + 38, ty + 50, { size: 9, color: '#ff8a00' });
      text(`冷${ha.levelBreakdown.cold||0}`, PAD + 60, ty + 50, { size: 9, color: '#1976d2' });
      const right = ha.fullMatchCount > 0 ? `完全匹配 ${ha.fullMatchCount} 期` : '无完全匹配';
      text(right, PAD + W - PAD * 2 - 14, ty + 22, { size: 9, color: ha.fullMatchCount > 0 ? '#4caf50' : '#999', align: 'right' });
      ty += 70;
    }
  }
  return y + h;
}

function drawHotCold(y) {
  if (!state.hotcoldRows.length) return y;
  const h = 36 + state.hotcoldRows.length * 38 + 10;
  fillRound(PAD, y, W - PAD * 2, h, 8, '#fff');
  text('🔥 热号 / 冷号 Top 5', PAD + 12, y + 8, { size: 12, weight: 'bold', color: '#222' });
  let ty = y + 32;
  for (const r of state.hotcoldRows) {
    text(`${r.emoji} ${r.label}`, PAD + 12, ty, { size: 10, color: '#333' });
    const ballSize = 18;
    const startX = PAD + 100;
    for (let i = 0; i < r.items.length; i++) {
      const b = r.items[i];
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(startX + i * (ballSize + 4) + ballSize / 2, ty + ballSize / 2 - 2, ballSize / 2, 0, Math.PI * 2);
      ctx.fill();
      text(b.padded, startX + i * (ballSize + 4) + ballSize / 2, ty + (ballSize - 12) / 2 - 2,
        { size: 9, weight: 'bold', color: '#fff', align: 'center' });
    }
    ty += 32;
  }
  return y + h;
}

function drawAgreementBar(y) {
  const h = 50;
  fillRound(PAD, y, W - PAD * 2, h, 8, '#fff');
  text('使用本程序即视为同意', PAD + 12, y + 8, { size: 10, color: '#666' });
  text('《用户协议》', PAD + 116, y + 8, { size: 10, color: colorByLottery(state.lottery) });
  text('与', PAD + 174, y + 8, { size: 10, color: '#666' });
  text('《隐私政策》', PAD + 188, y + 8, { size: 10, color: colorByLottery(state.lottery) });
  text('彩票仅为娱乐参考 · 请理性购彩', W / 2, y + 28, { size: 10, color: '#999', align: 'center' });
  return y + h;
}

function computeLayout() {
  // 票面
  let y = NAV_BAR_H + STATUS_H + 6;
  layoutY = { startY: y, ticketH: 0 };
  y += HEADER_H + 14;
  y += 20;           // 选择彩种 文本
  y += 32 + 12;      // 彩种按钮 + 间距
  if (state.lottery === 'ssq') y += 20;
  y += 40 + 14;      // 生成按钮 + 间距
  y += 20;           // 本期投注
  const betCount = state.currentBets.length || 1;
  y += (state.currentBets.length === 0 ? 40 : (state.currentBets.length * 86 + (state.currentBets.length - 1) * 8));
  y += 4;
  y += 1 + 10;       // 虚线 + 间距
  y += 24;           // 注数
  y += 16;           // 二维码下方
  y += 8;
  layoutY.ticketH = y - layoutY.startY;

  // 各附加面板
  y += SECTION_GAP;
  if (state.lottery === 'ssq') {
    y = drawStructures(y) + SECTION_GAP;
    y = drawOverlap(y) + SECTION_GAP;
  }
  y = drawHistoryPanel(y) + SECTION_GAP;
  y = drawHotCold(y) + SECTION_GAP;
  y = drawAgreementBar(y) + 8;
  layoutY.totalH = y;
}

function updateScrollBounds() {
  state.scrollMin = 0;
  state.scrollMax = Math.max(0, layoutY.totalH - H);
  if (state.scrollY < state.scrollMin) state.scrollY = state.scrollMin;
  if (state.scrollY > state.scrollMax) state.scrollY = state.scrollMax;
  markDirty();
}

function draw() {
  computeLayout();
  updateScrollBounds();
  // 背景
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, W, H);
  // 顶部 nav + status
  drawNavBar();
  // 滚动内容：translate + 视口裁剪
  const top = NAV_BAR_H + STATUS_H;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, W, H - top);
  ctx.clip();
  ctx.translate(0, -state.scrollY);
  drawTicketCard();
  let y = layoutY.startY + layoutY.ticketH + SECTION_GAP;
  if (state.lottery === 'ssq') {
    y = drawStructures(y) + SECTION_GAP;
    y = drawOverlap(y) + SECTION_GAP;
  }
  y = drawHistoryPanel(y) + SECTION_GAP;
  y = drawHotCold(y) + SECTION_GAP;
  y = drawAgreementBar(y) + 8;
  ctx.restore();
  // 导出 modal
  if (state.showExportModal) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    const mw = Math.min(W - 40, 320);
    const mh = 180;
    const mx = (W - mw) / 2;
    const my = (H - mh) / 2;
    fillRound(mx, my, mw, mh, 12, '#fff');
    let icon = '⏳';
    let iconColor = '#666';
    if (state.exportState === 'rendering') { icon = '⏳'; iconColor = '#1976d2'; }
    else if (state.exportState === 'saving') { icon = '💾'; iconColor = '#1976d2'; }
    else if (state.exportState === 'done') { icon = '✓'; iconColor = '#4caf50'; }
    else if (state.exportState === 'failed') { icon = '✕'; iconColor = '#e60012'; }
    text(icon, W / 2, my + 24, { size: 36, color: iconColor, align: 'center' });
    let title = '导出图片';
    if (state.exportState === 'rendering') title = '正在生成…';
    else if (state.exportState === 'saving') title = '正在保存…';
    else if (state.exportState === 'done') title = '导出成功';
    else if (state.exportState === 'failed') title = '导出失败';
    text(title, W / 2, my + 70, { size: 16, weight: 'bold', color: '#222', align: 'center' });
    text(state.exportMsg || '', W / 2, my + 96, { size: 12, color: '#666', align: 'center' });
    if (state.exportState === 'done' || state.exportState === 'failed') {
      const bw = 120, bh = 36;
      const bx = (W - bw) / 2;
      const by = my + mh - bh - 16;
      fillRound(bx, by, bw, bh, 8, colorByLottery(state.lottery));
      text('关闭', W / 2, by + (bh - 16) / 2, { size: 14, color: '#fff', weight: 'bold', align: 'center' });
      layoutY.exportModalCloseX = bx;
      layoutY.exportModalCloseY = by;
      layoutY.exportModalCloseW = bw;
      layoutY.exportModalCloseH = bh;
    } else {
      layoutY.exportModalCloseX = undefined;
    }
  } else {
    layoutY.exportModalCloseX = undefined;
  }
}

function _hitTestButtons(clientX, clientY) {
  if (!layoutY || layoutY.tabY === undefined) return null;
  const tw = W - PAD * 2;
  const innerW = tw - 28;
  const btnW = (innerW - 10) / 2;
  const btnH = 32;
  // 关键：按钮是画在 ctx.translate(0, -scrollY) 坐标系下，
  // 屏幕坐标 = layout 坐标 - scrollY
  const sy = -state.scrollY;
  const yTab = layoutY.tabY + sy;
  if (inRect(clientX, clientY, PAD + 14, yTab, btnW, btnH)) return { kind: 'tab', val: 'ssq' };
  if (inRect(clientX, clientY, PAD + 14 + btnW + 10, yTab, btnW, btnH)) return { kind: 'tab', val: 'dlt' };
  if (layoutY.genBtnY !== undefined) {
    const yGen = layoutY.genBtnY + sy;
    if (inRect(clientX, clientY, PAD + 14, yGen, tw - 28, layoutY.genBtnH)) return { kind: 'generate' };
  }
  if (layoutY.exportBtnX !== undefined) {
    const yExp = layoutY.exportBtnY + sy;
    if (inRect(clientX, clientY, layoutY.exportBtnX, yExp, layoutY.exportBtnW, layoutY.exportBtnH)) return { kind: 'export' };
  }
  return null;
}

// ===== 导出图片 =====
let _exportCanvas = null;
let _exportCtx = null;

function _getExportCanvas() {
  if (_exportCanvas) return _exportCanvas;
  if (typeof wx.createOffscreenCanvas === 'function') {
    _exportCanvas = wx.createOffscreenCanvas({ type: '2d', width: 750, height: 1200 });
  } else {
    _exportCanvas = canvas;
  }
  _exportCtx = _exportCanvas.getContext('2d');
  return _exportCanvas;
}

function _roundedRectPath2(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

function _drawExportBetRow(c, bet, analysis, y, tx, tw) {
  const x = tx + 28;
  const w = tw - 56;
  const h = 80;
  c.fillStyle = '#fafafa';
  _roundedRectPath2(c, x, y, w, h, 8);
  c.fill();
  const color = colorByLottery(state.lottery);
  c.fillStyle = color;
  _roundedRectPath2(c, x + 12, y + 12, 50, 50, 6);
  c.fill();
  c.fillStyle = '#fff';
  c.font = 'bold 22px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(bet.indexPadded, x + 37, y + 38);
  c.font = '12px sans-serif';
  c.fillText(bet.label, x + 37, y + 72);
  const primary = bet.primary;
  const secondary = bet.secondary;
  const ballStartX = x + 84;
  const ballSize = 36;
  const ballGap = 6;
  for (let i = 0; i < primary.length; i++) {
    _drawExportBall(c, ballStartX + i * (ballSize + ballGap), y + 12, ballSize, primary[i]);
  }
  const sepX = ballStartX + primary.length * (ballSize + ballGap) + 4;
  c.strokeStyle = '#ddd';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(sepX, y + 16); c.lineTo(sepX, y + 52); c.stroke();
  for (let i = 0; i < secondary.length; i++) {
    _drawExportBall(c, sepX + 6 + i * (ballSize + ballGap), y + 12, ballSize, secondary[i], '#1976d2');
  }
  return y + h;
}

const _exportBallCache = new Map();
function _getExportBallGrad(color, size) {
  const k = color + ':' + size;
  let g = _exportBallCache.get(k);
  if (g) return g;
  g = _exportCtx.createRadialGradient(0, 0, 1, 0, 0, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  _exportBallCache.set(k, g);
  return g;
}
function _drawExportBall(c, x, y, size, ball, fallbackColor) {
  const col = ball.color || fallbackColor || '#e60012';
  c.fillStyle = col;
  c.beginPath();
  c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.translate(x + size / 2, y + size / 2);
  c.fillStyle = _getExportBallGrad(col, size);
  c.beginPath();
  c.arc(0, 0, size / 2, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.fillStyle = '#fff';
  c.font = 'bold 18px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(ball.padded, x + size / 2, y + size / 2);
  if (ball.freq) {
    c.font = '10px sans-serif';
    c.fillText(String(ball.freq), x + size / 2, y + size - 5);
  }
}

function _renderTicketForExport(ec, c) {
  const W2 = 750, H2 = 1200;
  const PAD2 = 32;
  c.fillStyle = '#f5f5f5';
  c.fillRect(0, 0, W2, H2);
  const tx = PAD2, ty = 60;
  const tw = W2 - PAD2 * 2;
  const titleH = 110;
  const betCount = state.currentBets.length;
  const betRowH = 90;
  const betListH = betCount > 0 ? betCount * betRowH + (betCount - 1) * 10 : 90;
  const footH = 200;
  const th = titleH + 30 + betListH + 30 + footH;
  c.fillStyle = '#fff';
  _roundedRectPath2(c, tx, ty, tw, th, 16);
  c.fill();
  const color = colorByLottery(state.lottery);
  c.fillStyle = color;
  _roundedRectPath2(c, tx, ty, tw, titleH, 16);
  c.fill();
  c.fillStyle = '#fff';
  c.fillRect(tx, ty + titleH - 14, tw, 14);
  c.fillStyle = '#fff';
  c.font = 'bold 38px sans-serif';
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillText(state.lottery === 'ssq' ? '双色球' : '大乐透', tx + 28, ty + 32);
  const issueText = state.historySummary.latestIssue ? `第 ${state.historySummary.latestIssue} 期参考` : '方案';
  c.font = '20px sans-serif';
  c.textAlign = 'right';
  c.fillText(issueText, tx + tw - 28, ty + 36);
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.font = '16px sans-serif';
  c.textAlign = 'left';
  c.fillText(state.lottery === 'ssq' ? '原始策略（4+2）' : '前区 5 + 后区 2', tx + 28, ty + 78);
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  c.textAlign = 'right';
  c.fillText(timeStr, tx + tw - 28, ty + 78);
  let y = ty + titleH + 20;
  c.strokeStyle = '#eee';
  c.beginPath();
  c.moveTo(tx + 28, y); c.lineTo(tx + tw - 28, y); c.stroke();
  y += 16;
  if (betCount === 0) {
    c.fillStyle = '#999';
    c.font = '24px sans-serif';
    c.textAlign = 'center';
    c.fillText('点击生成一注后再导出', tx + tw / 2, y + 30);
  } else {
    for (let i = 0; i < betCount; i++) {
      const bet = state.currentBets[i];
      y = _drawExportBetRow(c, bet, state.historyAnalysis.per_bet[i], y, tx, tw);
      y += 10;
    }
  }
  y += 10;
  c.strokeStyle = '#eee';
  c.beginPath();
  c.moveTo(tx + 28, y); c.lineTo(tx + tw - 28, y); c.stroke();
  y += 20;
  c.fillStyle = color;
  c.font = 'bold 30px sans-serif';
  c.textAlign = 'left';
  c.fillText(state.totalBets + ' 注', tx + 28, y);
  c.fillText(state.totalCost + ' 元', tx + 150, y);
  const qrSize = 100;
  const qrX = tx + tw - qrSize - 28;
  const qrY = y - 6;
  c.fillStyle = '#fff';
  c.fillRect(qrX, qrY, qrSize, qrSize);
  c.fillStyle = '#222';
  for (let r = 0; r < 14; r++) for (let cc = 0; cc < 14; cc++) {
    if ((r * 7 + cc + (r * cc * 3)) % 3 === 0) {
      c.fillRect(qrX + 6 + cc * 6.5, qrY + 6 + r * 6.5, 5, 5);
    }
  }
  const cornerSize = 22;
  c.fillStyle = '#fff';
  c.fillRect(qrX, qrY, cornerSize, cornerSize);
  c.fillRect(qrX + qrSize - cornerSize, qrY, cornerSize, cornerSize);
  c.fillRect(qrX, qrY + qrSize - cornerSize, cornerSize, cornerSize);
  c.fillStyle = '#222';
  c.fillRect(qrX + 4, qrY + 4, cornerSize - 8, cornerSize - 8);
  c.fillRect(qrX + qrSize - cornerSize + 4, qrY + 4, cornerSize - 8, cornerSize - 8);
  c.fillRect(qrX + 4, qrY + qrSize - cornerSize + 4, cornerSize - 8, cornerSize - 8);
  y += 60;
  c.fillStyle = '#999';
  c.font = '18px sans-serif';
  c.textAlign = 'center';
  c.fillText('彩票仅为娱乐参考 · 请理性购彩', tx + tw / 2, y);
  y += 30;
  c.fillText('—— 生成于 彩票投注方案生成器 ——', tx + tw / 2, y);
}

function showExportModal() {
  try {
    if (!state.currentBets || state.currentBets.length === 0) {
      try { wx.showToast({ title: '请先生成一注', icon: 'none' }); } catch(e) {}
      return;
    }
    let listText = '';
    try {
      listText = _buildListText();
    } catch (e) {
      console.error('[EXPORT] buildListText error', e);
      try { wx.showToast({ title: '清单生成失败', icon: 'none' }); } catch(e) {}
      return;
    }
    console.log('[EXPORT] list text:', listText);
    // 方案 A：直接复制纯文本到剪贴板
    try {
      wx.setClipboardData({
        data: listText,
        success: () => {
          console.log('[EXPORT] clipboard success');
          try { wx.showToast({ title: '清单已复制，可发给店主', icon: 'success', duration: 3000 }); } catch(e) {}
        },
        fail: err => {
          console.error('[EXPORT] clipboard fail', err);
          try { wx.showModal({ title: '已生成清单', content: listText, showCancel: false, confirmText: '关闭' }); } catch(e) {}
        }
      });
    } catch (e) {
      console.error('[EXPORT] clipboard throw', e);
      try { wx.showModal({ title: '已生成清单', content: listText, showCancel: false, confirmText: '关闭' }); } catch(e) {}
    }
  } catch (fatal) {
    console.error('[EXPORT] showExportModal fatal', fatal);
    try { wx.showToast({ title: '导出异常', icon: 'none' }); } catch(e) {}
  }
}

function _buildListText() {
  // 构建纯文本购买清单（带 try-catch 防止某个 bet 字段异常炸掉整个流程）
  const lines = [];
  try {
    const lot = state.lottery === 'ssq' ? '双色球' : '大乐透';
    const issue = state.historySummary.latestIssue ? `第 ${state.historySummary.latestIssue} 期参考` : '方案';
    lines.push(`${lot}  ${issue}`);
    const now = new Date();
    const timeStr = `生成时间：${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    lines.push(timeStr);
    lines.push('------------------------------');
    for (let i = 0; i < state.currentBets.length; i++) {
      const bet = state.currentBets[i];
      // 诊断：打印每个 bet 的所有键
      console.log('[buildListText] bet', i, 'keys=', Object.keys(bet), 'bet=', JSON.stringify(bet));
      lines.push(`第 ${pad(i + 1)} 注 (${bet.label || ''})`);
      // 用 try-catch 隔离每注的处理
      let primaryText = '';
      let secondaryText = '';
      try {
        // 容错：兼容各种字段名
        let primary, secondary, primaryLabel, secondaryLabel;
        if (state.lottery === 'ssq') {
          primary = bet.reds || bet.fronts || [];
          secondary = bet.blue != null ? [bet.blue] : (bet.backs || []);
          primaryLabel = '红球';
          secondaryLabel = '蓝球';
        } else {
          primary = bet.fronts || bet.reds || [];
          secondary = bet.backs || (bet.blue != null ? [bet.blue] : []) || [];
          primaryLabel = '前区';
          secondaryLabel = '后区';
        }
        // 容错：如果 primary/secondary 不是数组
        if (!Array.isArray(primary)) primary = [];
        if (!Array.isArray(secondary)) secondary = [];
        primaryText = primaryLabel + '：' + primary.map(n => pad(Number(n) || 0)).join('  ');
        secondaryText = secondaryLabel + '：' + secondary.map(n => pad(Number(n) || 0)).join('  ');
      } catch (e) {
        console.error('[buildListText] bet error', i, e);
        primaryText = '红球：数据错误';
        secondaryText = '蓝球：数据错误';
      }
      lines.push(primaryText);
      lines.push(secondaryText);
    }
    lines.push('------------------------------');
    lines.push(`合计  ${state.totalBets} 注   共 ${state.totalCost} 元`);
    lines.push('彩票仅为娱乐参考，请理性购彩');
  } catch (e) {
    console.error('[buildListText] fatal', e);
    lines.push('清单生成出错：' + (e.message || e));
  }
  return lines.join('\n');
}

function _restoreCanvas(oldW, oldH, oldScale) {
  // 恢复主 canvas 尺寸
  try { canvas.width = oldW; canvas.height = oldH; } catch(e) {}
  if (oldScale) {
    try { ctx.setTransform(oldScale.a, oldScale.b, oldScale.c, oldScale.d, oldScale.e, oldScale.f); } catch(e) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  } else {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function _doExport() {
  // 关键：先关闭 modal（避免半透明层被截进图）
  state.showExportModal = false;
  state.exportState = 'saving';
  state.exportMsg = '正在保存…';
  markDirty();
  console.log('[EXPORT] start, currentBets=', state.currentBets.length, 'dpr=', dpr, 'W=', W, 'H=', H);

  // 保存主 canvas 当前状态
  const oldW = canvas.width, oldH = canvas.height;
  let oldScale = null;
  try { oldScale = ctx.getTransform(); } catch(e) {}

  // 设主 canvas 物理尺寸为 750x1200
  const targetW = 750, targetH = 1200;
  let resized = false;
  try {
    canvas.width = targetW;
    canvas.height = targetH;
    resized = true;
    console.log('[EXPORT] canvas resized to', canvas.width, 'x', canvas.height);
  } catch (e) {
    console.error('[EXPORT] resize failed', e);
  }

  // 完整重置 transform：scale(dpr) + translate + dpr 归零
  // 之前用 ctx.setTransform(1,0,0,1,0,0) 可能没彻底清掉
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(1, 1);
  ctx.translate(0, 0);

  // 画导出图（用清理过的 ctx）
  try {
    _renderTicketForExportRaw(targetW, targetH);
    console.log('[EXPORT] draw done');
  } catch (e) {
    console.error('[EXPORT] draw failed', e);
    state.exportState = 'failed';
    state.exportMsg = '画图失败：' + (e.message || e);
    markDirty();
    _restoreCanvas(oldW, oldH, oldScale);
    return;
  }

  state.exportMsg = '正在保存到相册…';
  markDirty();

  // 10 秒超时保护
  let responded = false;
  const timeoutId = setTimeout(() => {
    if (responded) return;
    responded = true;
    console.error('[EXPORT] TIMEOUT: canvasToTempFilePath no callback after 10s');
    state.exportState = 'failed';
    state.exportMsg = '截图超时';
    markDirty();
    try { wx.showToast({ title: '截图超时', icon: 'none' }); } catch(e) {}
    _restoreCanvas(oldW, oldH, oldScale);
  }, 10000);

  // 截图
  try {
    console.log('[EXPORT] calling canvas.toTempFilePath...');
    if (typeof canvas.toTempFilePath !== 'function') {
      throw new Error('canvas.toTempFilePath 不可用');
    }
    canvas.toTempFilePath({
      fileType: 'png',
      quality: 1,
      success: res => {
        if (responded) return;
        responded = true;
        clearTimeout(timeoutId);
        console.log('[EXPORT] canvasToTempFilePath success', res);
        const tempPath = res.tempFilePath;
        state.exportImgPath = tempPath;
        _restoreCanvas(oldW, oldH, oldScale);
        markDirty();
        _saveToAlbum(tempPath);
      },
      fail: err => {
        if (responded) return;
        responded = true;
        clearTimeout(timeoutId);
        console.error('[EXPORT] canvasToTempFilePath fail', err);
        const em = (err && err.errMsg) || JSON.stringify(err);
        state.exportState = 'failed';
        state.exportMsg = '截图失败：' + em;
        markDirty();
        try { wx.showToast({ title: '截图失败', icon: 'none' }); } catch(e) {}
        _restoreCanvas(oldW, oldH, oldScale);
      }
    });
  } catch (e) {
    if (!responded) {
      responded = true;
      clearTimeout(timeoutId);
    }
    console.error('[EXPORT] canvas.toTempFilePath throw', e);
    let em = (e && e.message) || e;
    if (typeof em === 'object') em = JSON.stringify(em);
    state.exportState = 'failed';
    state.exportMsg = '调用失败：' + em;
    markDirty();
    try { wx.showToast({ title: '调用失败', icon: 'none' }); } catch(e) {}
    _restoreCanvas(oldW, oldH, oldScale);
  }
}

function _saveToAlbum(tempPath) {
  let responded = false;
  const timeoutId = setTimeout(() => {
    if (responded) return;
    responded = true;
    console.error('[EXPORT] saveImageToPhotosAlbum TIMEOUT');
    state.exportState = 'failed';
    state.exportMsg = '保存超时';
    markDirty();
    try { wx.showToast({ title: '保存超时', icon: 'none' }); } catch(e) {}
  }, 10000);
  try {
    console.log('[EXPORT] calling saveImageToPhotosAlbum', tempPath);
    wx.saveImageToPhotosAlbum({
      filePath: tempPath,
      success: () => {
        if (responded) return;
        responded = true;
        clearTimeout(timeoutId);
        console.log('[EXPORT] saveImageToPhotosAlbum success');
        state.exportState = 'done';
        state.exportMsg = '✓ 已保存到相册';
        markDirty();
        try { wx.showToast({ title: '已保存到相册', icon: 'success', duration: 2000 }); } catch(e) {}
        setTimeout(() => { state.showExportModal = false; markDirty(); }, 2500);
      },
      fail: err => {
        if (responded) return;
        responded = true;
        clearTimeout(timeoutId);
        console.error('[EXPORT] saveImageToPhotosAlbum fail', err);
        const em = (err && err.errMsg) || JSON.stringify(err);
        const errno = (err && err.errno) || 0;
        state.exportState = 'failed';
        if (errno === 1026 || em.indexOf('NeedPrivacyAuthoriz') >= 0 || em.indexOf('official popup') >= 0 || em.indexOf('onNeedPrivacy') >= 0) {
          state.exportMsg = '需要先授权隐私协议（点击查看教程）';
        } else if (errno === 112 || em.indexOf('api scope') >= 0 || em.indexOf('privacy agreement') >= 0) {
          // mp.weixin.qq.com 后台未声明相册写入 scope
          state.exportMsg = '需后台配置：mp.weixin.qq.com → 设置 → 用户隐私保护指引 → 添加 Album scope';
          // 用 modal 详细说明
          try { wx.showModal({
            title: '需要后台配置',
            content: '请到 mp.weixin.qq.com 后台：\n\n设置 → 服务类目与隐私协议 → 用户隐私保护指引 → 添加「相册写入 (Album)」scope\n\n添加后重新提交审核。',
            showCancel: false,
            confirmText: '我知道了'
          }); } catch(e) {}
        } else if (em.indexOf('auth deny') >= 0 || em.indexOf('authorize') >= 0) {
          state.exportMsg = '需要相册权限';
        } else if (em.indexOf('deny') >= 0 || em.indexOf('cancel') >= 0) {
          state.exportMsg = '已取消保存';
        } else {
          state.exportMsg = '保存失败：' + em;
        }
        markDirty();
        try { wx.showToast({ title: '保存失败：' + state.exportMsg.substring(0,20), icon: 'none', duration: 3000 }); } catch(e) {}
      }
    });
  } catch (e) {
    if (!responded) {
      responded = true;
      clearTimeout(timeoutId);
    }
    console.error('[EXPORT] saveImageToPhotosAlbum throw', e);
    state.exportState = 'failed';
    state.exportMsg = '调用失败：' + (e.message || e);
    markDirty();
  }
}

// 简洁清单导出图（用户要的就是这个）
// 设计：800 x (动态高) 像素，白底黑字，每注一行
// 格式：
//   双色球 第 2026086 期
//   生成时间：2026-07-30 19:48
//   ────────────────────
//   第 1 注 (A 组)
//   红球：09 14 22 25 28 29
//   蓝球：11
//   第 2 注 (A 组)
//   ...
//   ────────────────────
//   合计 6 注  共 12 元
//   彩票仅为娱乐参考，请理性购彩
function _renderTicketForExportRaw(W2, H2) {
  const betCount = state.currentBets.length;
  const LINE_H = 56;          // 每行高
  const ROW_H = LINE_H * 3 + 16; // 每注 3 行 + 间距
  const TITLE_H = 90;
  const DIVIDER_H = 24;
  const FOOTER_H = 80;
  const TARGET_H = TITLE_H + 30 + (betCount > 0 ? betCount * ROW_H + 16 : 60) + DIVIDER_H + FOOTER_H + 40;
  // 注意：H2 是参数（外部传 1200），但我们画的内容由 TARGET_H 决定
  // 实际 canvas 已经 resize 到 800x1200，所以我们画在 0~TARGET_H 范围内，下方留白

  // 背景白
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W2, H2);

  // 标题
  const tx = 40;
  let y = 30;
  ctx.fillStyle = '#222';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lotteryName = state.lottery === 'ssq' ? '双色球' : '大乐透';
  const issueText = state.historySummary.latestIssue ? `第 ${state.historySummary.latestIssue} 期参考` : '方案';
  ctx.fillText(`${lotteryName}  ${issueText}`, tx, y);
  y += 50;
  // 生成时间
  const now = new Date();
  const timeStr = `生成时间：${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  ctx.fillStyle = '#888';
  ctx.font = '20px sans-serif';
  ctx.fillText(timeStr, tx, y);
  y += 36;

  // 分割线
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx, y); ctx.lineTo(W2 - tx, y); ctx.stroke();
  y += 16;

  if (betCount === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('点击生成一注后再导出', W2 / 2, y + 30);
    return;
  }

  // 每注
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'left';
  for (let i = 0; i < betCount; i++) {
    const bet = state.currentBets[i];
    const primary = bet.primary;
    const secondary = bet.secondary;
    // 注标题
    ctx.fillStyle = '#e60012';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`第 ${bet.indexPadded} 注 (${bet.label})`, tx, y);
    y += 36;
    // 红球
    ctx.fillStyle = '#e60012';
    ctx.font = '28px sans-serif';
    const primaryText = state.lottery === 'ssq' ? '红球：' : '前区：';
    ctx.fillText(primaryText + primary.map(n => pad(n)).join('  '), tx, y);
    y += 38;
    // 蓝球
    ctx.fillStyle = '#1976d2';
    const secondaryText = state.lottery === 'ssq' ? '蓝球：' : '后区：';
    ctx.fillText(secondaryText + secondary.map(n => pad(n)).join('  '), tx, y);
    y += 42;
    // 间隔线
    if (i < betCount - 1) {
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, y - 8); ctx.lineTo(W2 - tx, y - 8); ctx.stroke();
    }
  }
  y += 6;
  // 分割线
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx, y); ctx.lineTo(W2 - tx, y); ctx.stroke();
  y += 16;
  // 合计
  ctx.fillStyle = '#222';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(`合计  ${state.totalBets} 注   共 ${state.totalCost} 元`, tx, y);
  y += 50;
  // 免责声明
  ctx.fillStyle = '#999';
  ctx.font = '20px sans-serif';
  ctx.fillText('彩票仅为娱乐参考，请理性购彩', tx, y);
}

function _drawExportBetRowRaw(c, bet, y, tx, tw) {
  const x = tx + 28;
  const w = tw - 56;
  const h = 80;
  c.fillStyle = '#fafafa';
  c.beginPath();
  c.moveTo(x + 8, y); c.arcTo(x + w, y, x + w, y + 8, 8);
  c.lineTo(x + w, y + h - 8); c.arcTo(x + w, y + h, x + w - 8, y + h, 8);
  c.lineTo(x + 8, y + h); c.arcTo(x, y + h, x, y + h - 8, 8);
  c.lineTo(x, y + 8); c.arcTo(x, y, x + 8, y, 8);
  c.closePath(); c.fill();
  const color = colorByLottery(state.lottery);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x + 20, y + 12); c.arcTo(x + 64, y + 12, x + 64, y + 56, 6);
  c.lineTo(x + 64, y + 56); c.arcTo(x + 64, y + 62, x + 58, y + 62, 6);
  c.lineTo(x + 20, y + 62); c.arcTo(x + 14, y + 62, x + 14, y + 56, 6);
  c.lineTo(x + 14, y + 18); c.arcTo(x + 14, y + 12, x + 20, y + 12, 6);
  c.closePath(); c.fill();
  c.fillStyle = '#fff';
  c.font = 'bold 22px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(bet.indexPadded, x + 39, y + 38);
  c.font = '12px sans-serif';
  c.fillText(bet.label, x + 39, y + 72);
  const primary = bet.primary;
  const secondary = bet.secondary;
  const ballStartX = x + 84;
  const ballSize = 36;
  const ballGap = 6;
  for (let i = 0; i < primary.length; i++) {
    _drawExportBallRaw(c, ballStartX + i * (ballSize + ballGap), y + 12, ballSize, primary[i]);
  }
  const sepX = ballStartX + primary.length * (ballSize + ballGap) + 4;
  c.strokeStyle = '#ddd';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(sepX, y + 16); c.lineTo(sepX, y + 52); c.stroke();
  for (let i = 0; i < secondary.length; i++) {
    _drawExportBallRaw(c, sepX + 6 + i * (ballSize + ballGap), y + 12, ballSize, secondary[i], '#1976d2');
  }
  return y + h;
}

function _drawExportBallRaw(c, x, y, size, ball, fallbackColor) {
  const col = ball.color || fallbackColor || '#e60012';
  c.fillStyle = col;
  c.beginPath();
  c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.font = 'bold 18px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(ball.padded, x + size / 2, y + size / 2);
  if (ball.freq) {
    c.font = '10px sans-serif';
    c.fillText(String(ball.freq), x + size / 2, y + size - 5);
  }
}

let _inertiaRAF = null;
function _startInertia(initialVel) {
  // initialVel: px/ms，正=继续向下滚动（看下方），负=继续向上滚动（看上方）
  let v = initialVel;
  const friction = 0.92;   // 每 16.67ms 衰减 8%
  const stop = 0.04;        // 低于这个速度就停
  if (_inertiaRAF) cancelAnimationFrame(_inertiaRAF);
  let last = performance.now();
  function step(now) {
    const dt = now - last;
    last = now;
    if (state.scrollY <= state.scrollMin || state.scrollY >= state.scrollMax) {
      state.scrollY = Math.max(state.scrollMin, Math.min(state.scrollMax, state.scrollY));
      state.scrollVelocity = 0;
      _inertiaRAF = null;
      markDirty();
      return;
    }
    state.scrollY += v * dt;
    if (state.scrollY < state.scrollMin) state.scrollY = state.scrollMin;
    if (state.scrollY > state.scrollMax) state.scrollY = state.scrollMax;
    const decay = Math.pow(friction, dt / 16.67);
    v *= decay;
    markDirty();
    if (Math.abs(v) < stop) {
      state.scrollVelocity = 0;
      _inertiaRAF = null;
      markDirty();
      return;
    }
    _inertiaRAF = requestAnimationFrame(step);
  }
  _inertiaRAF = requestAnimationFrame(step);
}

function setupTouch() {
  wx.onTouchStart(e => {
    const t = e.touches[0];
    state.touchStartY = t.clientY;
    state.touchLastY = t.clientY;
    state.touchStartScroll = state.scrollY;
    state.touchStartTime = Date.now();
    state.scrollVelocity = 0;   // 重新触摸取消惯性
    if (_inertiaRAF) { cancelAnimationFrame(_inertiaRAF); _inertiaRAF = null; }
    state.pressedBtn = _hitTestButtons(t.clientX, t.clientY);
    // 调试日志：用户可在 vConsole 中看到每次触摸的位置和命中结果
    const _sy = -state.scrollY;
    console.log('[TOUCH]', t.clientX, t.clientY, 'scrollY=', state.scrollY, 'layoutY=', JSON.stringify({
      tabY: layoutY.tabY, genBtnY: layoutY.genBtnY, exportBtnY: layoutY.exportBtnY
    }), 'screenY=', {
      tab: layoutY.tabY + _sy, gen: layoutY.genBtnY + _sy, export: layoutY.exportBtnY + _sy
    }, 'hit=', state.pressedBtn && state.pressedBtn.kind || 'none');
  });
  wx.onTouchMove(e => {
    const t = e.touches[0];
    const curY = t.clientY;
    const dy = curY - state.touchLastY;   // 上一帧增量
    state.touchLastY = curY;
    if (Math.abs(curY - state.touchStartY) > 4) state.pressedBtn = null;
    // 增量累加：手指上滑 dy<0 → scrollY 增大（看下方内容，符合自然滚动）
    state.scrollY -= dy;
    if (state.scrollY < state.scrollMin) state.scrollY = state.scrollMin;
    if (state.scrollY > state.scrollMax) state.scrollY = state.scrollMax;
    markDirty();
    // 估算速度（同样翻转符号）
    const now = Date.now();
    const dt = Math.max(1, now - state.touchStartTime);
    state.scrollVelocity = -(state.scrollY - state.touchStartScroll) / dt;
  });
  wx.onTouchEnd(() => {
    console.log('[TOUCH-END] pressedBtn=', state.pressedBtn && state.pressedBtn.kind || 'none', 'showExportModal=', state.showExportModal, 'currentBets=', state.currentBets.length);
    // 导出 modal 打开时：点关闭按钮 / 点其他位置都关闭
    if (state.showExportModal) {
      state.showExportModal = false;
      state.exportState = 'idle';
      state.exportMsg = '';
      state.pressedBtn = null;
      state.scrollVelocity = 0;
      markDirty();
      return;
    }
    // 先看是否是按钮点击
    if (state.pressedBtn) {
      if (state.pressedBtn.kind === 'tab' && state.lottery !== state.pressedBtn.val) {
        state.lottery = state.pressedBtn.val;
        state.scrollY = 0;
        generate();
      } else if (state.pressedBtn.kind === 'generate' && !state.generating) {
        generate();
      } else if (state.pressedBtn.kind === 'export') {
        showExportModal();
      }
      state.pressedBtn = null;
      state.scrollVelocity = 0;
      return;
    }
    state.pressedBtn = null;
    // 惯性滚动
    if (Math.abs(state.scrollVelocity) > 1.5) {
      _startInertia(state.scrollVelocity);
    } else {
      state.scrollVelocity = 0;
    }
  });
}

// 渲染节流：只在脏状态时重绘
let _dirty = true;
function markDirty() { _dirty = true; }
function loop() {
  if (_dirty) {
    _dirty = false;
    draw();
  }
  requestAnimationFrame(loop);
}

// ===== 启动 =====
// 注册全局隐私授权回调（iOS 14+ 微信基础库 3.x 要求）
// 没有这个回调，wx.saveImageToPhotosAlbum 会返回 errno 1026
let _privacyResolve = null;
wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
  console.log('[PRIVACY] onNeedPrivacyAuthorization event=', eventInfo);
  // 缓存 resolve，等用户操作后再调用
  _privacyResolve = resolve;
  // 用 wx.showModal 模拟一个简单隐私弹窗
  // 注意：正式上线时需要做更友好的自定义弹窗 UI
  try {
    wx.showModal({
      title: '授权提示',
      content: '需要您的相册权限才能保存彩票图片到手机相册。是否同意？',
      confirmText: '同意',
      cancelText: '拒绝',
      success: (res) => {
        if (res.confirm) {
          console.log('[PRIVACY] user agreed');
          resolve({ event: 'agree' });
        } else {
          console.log('[PRIVACY] user disagreed');
          resolve({ event: 'disagree' });
        }
        _privacyResolve = null;
      },
      fail: () => {
        resolve({ event: 'disagree' });
        _privacyResolve = null;
      }
    });
  } catch (e) {
    console.error('[PRIVACY] showModal error', e);
    resolve({ event: 'agree' });  // fallback: 让流程继续走
    _privacyResolve = null;
  }
});
// 旧版 API 兼容：iOS 26 上可能也需要 wx.openPrivacyContract / wx.requirePrivacyAuthorize
if (typeof wx.requirePrivacyAuthorize === 'function') {
  console.log('[PRIVACY] wx.requirePrivacyAuthorize available');
}

initCanvas();
updateTime();
setInterval(updateTime, 60000);
generate();
setupTouch();
loop();

wx.onShow(() => updateTime());
