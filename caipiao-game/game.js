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
const library = require('./utils/library.js');
const network = require('./utils/network.js');

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
  touchLastX: 0,

  // ===== 我的彩票库 =====
  libraryCount: 0,
  libraryStats: null,       // {totalCost, totalPrize, netPnL, wonCount, ...}
  showLibraryModal: false,
  blueStats: null,
  libraryView: 'list',    // 'list' | 'detail'

  // ===== 最新开奖（启动联网拉） =====
  latestDraw: { ssq: null, dlt: null },
  latestDrawLoading: false,
  libraryList: [],
  librarySelectedId: null,
  libraryScrollY: 0,
  libraryDeleteTargetId: null,
  refreshing: false,
  toastText: '',
  toastUntil: 0,
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
    state.blueStats = result.blueStats || null;
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
  y += btnH + 8;

  // 上期开奖（联网拉）
  const drawH = drawLatestDraw(tx + 14, y, tw - 28);
  y += drawH + 6;

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
  // 导出按钮 + 保存到彩票库（同行，左右各占一半）
  const halfW = (tw - 28 - 10) / 2;
  drawExportButton(tx + 14, y, halfW, 40);
  layoutY.exportBtnX = tx + 14;
  layoutY.exportBtnY = y;
  layoutY.exportBtnW = halfW;
  layoutY.exportBtnH = 40;
  drawSaveToLibraryButton(tx + 14 + halfW + 10, y, halfW, 40);
  layoutY.saveBtnX = tx + 14 + halfW + 10;
  layoutY.saveBtnY = y;
  layoutY.saveBtnW = halfW;
  layoutY.saveBtnH = 40;
  y += 40 + 10;

  // 我的彩票库（独立行，带数字徽标）
  drawLibraryButton(tx + 14, y, tw - 28, 40);
  layoutY.libBtnX = tx + 14;
  layoutY.libBtnY = y;
  layoutY.libBtnW = tw - 28;
  layoutY.libBtnH = 40;
  y += 40 + 14;

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
  text('📋  导出数据到粘贴板', x + w / 2, y + (h - 14) / 2, { size: 14, weight: 'bold', color: colorByLottery(state.lottery), align: 'center' });
}

function drawSaveToLibraryButton(x, y, w, h) {
  const pressed = state.pressedBtn && state.pressedBtn.kind === 'save';
  const enabled = state.currentBets.length > 0;
  const stroke = pressed ? '#ff6f00' : (enabled ? '#ff6f00' : '#ccc');
  const txt = enabled ? colorByLottery(state.lottery) : '#999';
  fillRound(x, y, w, h, 8, pressed ? '#fff3e0' : '#fff');
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  roundedRectPath(x + 0.75, y + 0.75, w - 1.5, h - 1.5, 7.25);
  ctx.stroke();
  text('💾  保存到彩票库', x + w / 2, y + (h - 14) / 2, { size: 13, weight: 'bold', color: txt, align: 'center' });
}

function drawLatestDraw(x, y, w) {
  // 上期开奖展示条：显示最近一期的开奖号码
  const draw = state.latestDraw[state.lottery];
  const h = 60;
  fillRound(x, y, w, h, 8, '#fff8e1');
  if (state.latestDrawLoading && !draw) {
    text('⏳  正在拉取最新开奖...', x + w / 2, y + (h - 12) / 2,
      { size: 11, color: '#ff8a00', align: 'center' });
    return h;
  }
  if (!draw) {
    text('📋  暂无最新开奖（启动时会自动拉取）', x + w / 2, y + (h - 12) / 2,
      { size: 11, color: '#999', align: 'center' });
    text('也可在「📚 我的彩票库」里手动刷新', x + w / 2, y + (h - 12) / 2 + 18,
      { size: 9, color: '#bbb', align: 'center' });
    return h;
  }
  // 标题
  const lotName = state.lottery === 'ssq' ? '双色球' : '大乐透';
  text(`📋  上期开奖 ${draw.issue} 期`, x + 8, y + 8,
    { size: 11, weight: 'bold', color: '#666' });
  text(draw.date || '', x + w - 8, y + 9,
    { size: 9, color: '#999', align: 'right' });
  // 号码
  const ballY = y + 24;
  const ballSize = 18;
  const ballGap = 4;
  const primary = draw.primary || [];
  const primaryColor = state.lottery === 'ssq' ? '#e60012' : '#ff6f00';
  for (let i = 0; i < primary.length; i++) {
    const n = primary[i];
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.arc(x + 12 + i * (ballSize + ballGap) + ballSize / 2, ballY + ballSize / 2,
      ballSize / 2, 0, Math.PI * 2);
    ctx.fill();
    text(pad(n), x + 12 + i * (ballSize + ballGap) + ballSize / 2,
      ballY + ballSize / 2 - 6, { size: 10, weight: 'bold', color: '#fff', align: 'center' });
  }
  // 分隔线
  const sepX = x + 12 + primary.length * (ballSize + ballGap) + 4;
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sepX, ballY + 2); ctx.lineTo(sepX, ballY + ballSize - 2); ctx.stroke();
  // 次区
  const secondary = Array.isArray(draw.secondary) ? draw.secondary : [draw.secondary];
  const secondaryColor = state.lottery === 'ssq' ? '#1976d2' : '#00acc1';
  const secondaryLabel = state.lottery === 'ssq' ? '蓝' : '后';
  text(secondaryLabel, x + sepX + 4, ballY + ballSize / 2 - 6,
    { size: 10, color: secondaryColor, weight: 'bold' });
  for (let i = 0; i < secondary.length; i++) {
    const n = secondary[i];
    ctx.fillStyle = secondaryColor;
    ctx.beginPath();
    ctx.arc(x + sepX + 4 + 14 + i * (ballSize + ballGap) + ballSize / 2,
      ballY + ballSize / 2, ballSize / 2, 0, Math.PI * 2);
    ctx.fill();
    text(pad(n), x + sepX + 4 + 14 + i * (ballSize + ballGap) + ballSize / 2,
      ballY + ballSize / 2 - 6, { size: 10, weight: 'bold', color: '#fff', align: 'center' });
  }
  return h;
}

function drawLibraryButton(x, y, w, h) {
  const pressed = state.pressedBtn && state.pressedBtn.kind === 'library';
  fillRound(x, y, w, h, 8, pressed ? '#1976d2' : '#fff');
  ctx.strokeStyle = pressed ? '#1976d2' : '#1976d2';
  ctx.lineWidth = 1.5;
  roundedRectPath(x + 0.75, y + 0.75, w - 1.5, h - 1.5, 7.25);
  ctx.stroke();
  text('📚  我的彩票库', x + w / 2 - 8, y + (h - 14) / 2, { size: 13, weight: 'bold', color: '#1976d2', align: 'center' });
  // 右侧数字徽标
  if (state.libraryCount > 0) {
    const badgeText = state.libraryCount > 99 ? '99+' : String(state.libraryCount);
    const badgeW = Math.max(22, badgeText.length * 12 + 10);
    const badgeX = x + w - badgeW - 12;
    const badgeY = y + (h - 18) / 2;
    fillRound(badgeX, badgeY, badgeW, 18, 9, '#e60012');
    text(badgeText, badgeX + badgeW / 2, badgeY + 3, { size: 11, weight: 'bold', color: '#fff', align: 'center' });
  }
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
  const rows = state.overlapChecks;
  if (!rows || rows.length === 0) return y;
  const h = 20 + rows.length * 16 + 10;
  fillRound(PAD, y, W - PAD * 2, h, 8, '#fff');
  text('🔄 去重检查', PAD + 12, y + 8, { size: 12, weight: 'bold', color: '#222' });
  let ty = y + 28;
  for (const c of rows) {
    // 不同指标的不同比较语义：
    //   - 区间重叠（A∩B 等）：count <= limit
    //   - 全局去重（独立号码数）：count >= limit
    //   - 重复号码（单号出现组数 >2）：count <= limit（理想 0）
    let ok, hint, valText;
    if (c.name === '全局去重') {
      ok = c.count >= c.limit;
      hint = `≥${c.limit}`;
      valText = `${c.count} 个不同`;
    } else if (c.name === '重复号码') {
      ok = c.count <= c.limit;
      hint = `≤${c.limit}`;
      valText = `${c.count} 个`;
    } else {
      ok = c.count <= c.limit;
      hint = `≤${c.limit}`;
      valText = `${c.count} 个`;
    }
    text(`${c.name}（${hint}）`, PAD + 12, ty, { size: 10, color: '#666' });
    text(valText, PAD + W - PAD * 2 - 12, ty, { size: 10, weight: 'bold', color: ok ? '#4caf50' : '#e60012', align: 'right' });
    ty += 16;
  }
  // 蓝球统计
  const bs = state.blueStats;
  if (bs) {
    text(`蓝球: 奇${bs.oddCount} 偶${bs.evenCount}  小${bs.smallCount} 大${bs.largeCount}`,
      PAD + 12, ty, { size: 10, color: '#666' });
  }
  return y + h + (bs ? 4 : 0);
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
  y += 32 + 8;       // 彩种按钮 + 间距
  y += 60 + 6;       // 上期开奖 + 间距
  if (state.lottery === 'ssq') y += 20;
  y += 40 + 10;      // 生成按钮 + 间距
  y += 40 + 10;      // 导出+保存 行 + 间距
  y += 40 + 14;      // 我的彩票库 + 间距
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
  // 彩票库 modal
  if (state.showLibraryModal) {
    drawLibraryModal();
  }

  // Toast
  drawToast();
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
  if (layoutY.saveBtnX !== undefined) {
    const ySv = layoutY.saveBtnY + sy;
    if (inRect(clientX, clientY, layoutY.saveBtnX, ySv, layoutY.saveBtnW, layoutY.saveBtnH)) return { kind: 'save' };
  }
  if (layoutY.libBtnX !== undefined) {
    const yLb = layoutY.libBtnY + sy;
    if (inRect(clientX, clientY, layoutY.libBtnX, yLb, layoutY.libBtnW, layoutY.libBtnH)) return { kind: 'library' };
  }
  return null;
}

// ===== 导出到粘贴板 =====
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
      const primaryLabel = state.lottery === 'ssq' ? '红球' : '前区';
      const secondaryLabel = state.lottery === 'ssq' ? '蓝球' : '后区';
      let primaryNums = [];
      let secondaryNums = [];
      try {
        if (Array.isArray(bet.primary)) {
          primaryNums = bet.primary.map(b => (b && b.number != null) ? b.number : NaN).filter(n => !isNaN(n));
        }
        if (Array.isArray(bet.secondary)) {
          secondaryNums = bet.secondary.map(b => (b && b.number != null) ? b.number : NaN).filter(n => !isNaN(n));
        }
      } catch (e) {
        console.error('[buildListText] bet error', i, e);
      }
      const indexLabel = bet.indexPadded || pad(i + 1);
      lines.push(`第 ${indexLabel} 注 (${bet.label || ''})`);
      lines.push(primaryLabel + '：' + primaryNums.map(n => pad(Number(n) || 0)).join('  '));
      lines.push(secondaryLabel + '：' + secondaryNums.map(n => pad(Number(n) || 0)).join('  '));
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

function copyToClipboard() {
  if (!state.currentBets || state.currentBets.length === 0) {
    showToast('请先生成一注');
    return;
  }
  let listText = '';
  try {
    listText = _buildListText();
  } catch (e) {
    console.error('[CLIPBOARD] buildListText error', e);
    showToast('清单生成失败');
    return;
  }
  try {
    wx.setClipboardData({
      data: listText,
      success: () => {
        console.log('[CLIPBOARD] ok');
        showToast('✓ 已复制到粘贴板，可发给店主', 2200);
      },
      fail: err => {
        console.error('[CLIPBOARD] fail', err);
        // 失败时弹 modal 显示清单
        try {
          wx.showModal({
            title: '复制失败，请手动复制',
            content: listText,
            showCancel: false,
            confirmText: '关闭'
          });
        } catch (e2) {
          showToast('复制失败');
        }
      }
    });
  } catch (e) {
    console.error('[CLIPBOARD] throw', e);
    showToast('复制失败');
  }
}

// ===== 我的彩票库 =====
function saveCurrentToLibrary() {
  if (!state.currentBets || state.currentBets.length === 0) {
    showToast('请先生成一注');
    return;
  }
  try {
    const item = library.save({
      lottery: state.lottery,
      bets: state.currentBets,
      totalBets: state.totalBets,
      totalCost: state.totalCost,
      issue: state.historySummary.latestIssue || null
    });
    if (!item) {
      showToast('保存失败');
      return;
    }
    state.libraryCount = library.stats().total;
    showToast('✓ 已保存到彩票库（共 ' + state.libraryCount + ' 张）', 2200);
    markDirty();
  } catch (e) {
    console.error('[library] save error', e);
    showToast('保存失败：' + (e.message || e));
  }
}

function openLibraryModal() {
  state.libraryList = library.list();
  state.libraryStats = library.stats();
  state.libraryView = 'list';
  state.librarySelectedId = null;
  state.libraryScrollY = 0;
  state.libraryDeleteTargetId = null;
  state.showLibraryModal = true;
  state.libraryCount = state.libraryStats.total;
  markDirty();
}

function closeLibraryModal() {
  state.showLibraryModal = false;
  state.librarySelectedId = null;
  state.libraryDeleteTargetId = null;
  state.libraryView = 'list';
  state.libraryScrollY = 0;
  markDirty();
}

function refreshFromNetwork() {
  if (state.refreshing) return;
  state.refreshing = true;
  markDirty();
  showToast('🔄 拉取最新开奖...');
  Promise.all([
    network.fetchLatestForce('ssq').catch(() => null),
    network.fetchLatestForce('dlt').catch(() => null),
  ]).then(([ssqDraw, dltDraw]) => {
    let totalUpdated = 0;
    if (ssqDraw) totalUpdated += library.checkAll({ ssq: ssqDraw }).updated;
    if (dltDraw) totalUpdated += library.checkAll({ dlt: dltDraw }).updated;
    state.libraryList = library.list();
    state.libraryStats = library.stats();
    state.refreshing = false;
    if (totalUpdated > 0) {
      showToast(`✓ 已对照 ${totalUpdated} 张票`, 2000);
    } else {
      const ssqInfo = ssqDraw ? `SSQ ${ssqDraw.issue}` : 'SSQ -';
      const dltInfo = dltDraw ? `DLT ${dltDraw.issue}` : 'DLT -';
      showToast(`当前最新：${ssqInfo} / ${dltInfo}`, 2200);
    }
    markDirty();
  });
}

function _hitTestLibraryModal(clientX, clientY) {
  if (!state.showLibraryModal) return null;
  // 关闭按钮（左下）
  if (layoutY.libCloseX !== undefined) {
    if (inRect(clientX, clientY, layoutY.libCloseX, layoutY.libCloseY,
        layoutY.libCloseW, layoutY.libCloseH)) return { kind: 'libClose' };
  }
  // 刷新按钮（中下）
  if (layoutY.libRefreshX !== undefined && !state.refreshing) {
    if (inRect(clientX, clientY, layoutY.libRefreshX, layoutY.libRefreshY,
        layoutY.libRefreshW, layoutY.libRefreshH)) return { kind: 'libRefresh' };
  }
  // 清空按钮（右下）
  if (layoutY.libClearX !== undefined) {
    if (inRect(clientX, clientY, layoutY.libClearX, layoutY.libClearY,
        layoutY.libClearW, layoutY.libClearH)) return { kind: 'libClear' };
  }
  // 详情视图的返回按钮
  if (state.libraryView === 'detail' && layoutY.libBackX !== undefined) {
    if (inRect(clientX, clientY, layoutY.libBackX, layoutY.libBackY,
        layoutY.libBackW, layoutY.libBackH)) return { kind: 'libBack' };
  }
  // 详情视图的删除按钮
  if (state.libraryView === 'detail' && layoutY.libDeleteX !== undefined) {
    if (inRect(clientX, clientY, layoutY.libDeleteX, layoutY.libDeleteY,
        layoutY.libDeleteW, layoutY.libDeleteH)) return { kind: 'libDelete' };
  }
  // 详情视图的复制按钮
  if (state.libraryView === 'detail' && layoutY.libCopyX !== undefined) {
    if (inRect(clientX, clientY, layoutY.libCopyX, layoutY.libCopyY,
        layoutY.libCopyW, layoutY.libCopyH)) return { kind: 'libCopy' };
  }
  // 列表项
  if (state.libraryView === 'list' && layoutY.libItemYs) {
    for (let i = 0; i < layoutY.libItemYs.length; i++) {
      const it = layoutY.libItemYs[i];
      if (inRect(clientX, clientY, layoutY.libListX, it.y - state.libraryScrollY,
          layoutY.libListW, it.h)) return { kind: 'libItem', id: it.id, index: i };
    }
  }
  // 点其他位置（modal 外）→ 关闭
  if (layoutY.libModalX !== undefined) {
    if (!inRect(clientX, clientY, layoutY.libModalX, layoutY.libModalY,
        layoutY.libModalW, layoutY.libModalH)) return { kind: 'libDismiss' };
  }
  return null;
}

function handleLibraryModalClick(pressedBtn, clientX, clientY) {
  if (!pressedBtn) {
    closeLibraryModal();
    return;
  }
  const k = pressedBtn.kind;
  if (k === 'libClose' || k === 'libDismiss') {
    closeLibraryModal();
  } else if (k === 'libRefresh') {
    refreshFromNetwork();
  } else if (k === 'libClear') {
    try {
      wx.showModal({
        title: '清空彩票库？',
        content: '所有已保存的票将永久删除，无法恢复。',
        confirmText: '清空',
        confirmColor: '#e60012',
        success: (res) => {
          if (res.confirm) {
            library.clear();
            state.libraryList = [];
            state.libraryCount = 0;
            state.librarySelectedId = null;
            state.libraryView = 'list';
            showToast('已清空');
            markDirty();
          }
        }
      });
    } catch (e) {
      console.error('[library] clear confirm error', e);
    }
  } else if (k === 'libBack') {
    state.libraryView = 'list';
    state.librarySelectedId = null;
    markDirty();
  } else if (k === 'libDelete') {
    state.libraryDeleteTargetId = state.librarySelectedId;
    try {
      wx.showModal({
        title: '删除这张票？',
        content: '删除后无法恢复。',
        confirmText: '删除',
        confirmColor: '#e60012',
        success: (res) => {
          if (res.confirm && state.libraryDeleteTargetId) {
            library.remove(state.libraryDeleteTargetId);
            state.libraryList = library.list();
            state.libraryCount = library.stats().total;
            state.librarySelectedId = null;
            state.libraryView = 'list';
            showToast('已删除');
            markDirty();
          }
          state.libraryDeleteTargetId = null;
        }
      });
    } catch (e) {
      console.error('[library] delete confirm error', e);
      state.libraryDeleteTargetId = null;
    }
  } else if (k === 'libCopy') {
    const item = library.get(state.librarySelectedId);
    if (!item) {
      showToast('未找到该票');
      return;
    }
    const txt = _buildLibraryItemText(item);
    try {
      wx.setClipboardData({
        data: txt,
        success: () => showToast('✓ 已复制', 1800),
        fail: () => showToast('复制失败')
      });
    } catch (e) {
      showToast('复制失败');
    }
  } else if (k === 'libItem') {
    state.librarySelectedId = pressedBtn.id;
    state.libraryView = 'detail';
    state.libraryScrollY = 0;
    markDirty();
  }
}

function _buildLibraryItemText(item) {
  const lines = [];
  const lot = item.lottery === 'ssq' ? '双色球' : '大乐透';
  const issue = item.issue ? `第 ${item.issue} 期参考` : '方案';
  lines.push(`${lot}  ${issue}`);
  const d = new Date(item.savedAt);
  const ts = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  lines.push(`保存时间：${ts}`);
  lines.push('------------------------------');
  const primaryLabel = item.lottery === 'ssq' ? '红球' : '前区';
  const secondaryLabel = item.lottery === 'ssq' ? '蓝球' : '后区';
  for (const bet of item.bets) {
    const idx = pad(bet.index);
    lines.push(`第 ${idx} 注 (${bet.label || ''})`);
    lines.push(primaryLabel + '：' + bet.primary.map(n => pad(Number(n))).join('  '));
    lines.push(secondaryLabel + '：' + bet.secondary.map(n => pad(Number(n))).join('  '));
  }
  lines.push('------------------------------');
  lines.push(`合计  ${item.totalBets} 注   共 ${item.totalCost} 元`);
  lines.push('彩票仅为娱乐参考，请理性购彩');
  return lines.join('\n');
}

function drawLibraryModal() {
  // 全屏半透明遮罩
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);

  const mw = Math.min(W - 32, 360);
  const mh = Math.min(H - 80, 560);
  const mx = (W - mw) / 2;
  const my = (H - mh) / 2;
  fillRound(mx, my, mw, mh, 14, '#fff');
  layoutY.libModalX = mx;
  layoutY.libModalY = my;
  layoutY.libModalW = mw;
  layoutY.libModalH = mh;

  // 标题栏
  const titleH = 48;
  fillRound(mx, my, mw, titleH, 14, '#1976d2');
  ctx.fillStyle = '#fff';
  ctx.fillRect(mx, my + titleH - 14, mw, 14);
  const titleText = state.libraryView === 'detail' ? '📖  票详情' : '📚  我的彩票库';
  text(titleText, mx + 16, my + 14, { size: 16, weight: 'bold', color: '#fff' });
  text(state.libraryCount + ' 张', mx + mw - 16, my + 16, { size: 12, color: 'rgba(255,255,255,0.9)', align: 'right' });

  // 盈亏汇总（仅列表视图显示）
  let contentY = my + titleH + 8;
  let contentH = mh - titleH - 8 - 60;
  if (state.libraryView === 'list' && state.libraryStats) {
    const st = state.libraryStats;
    const sumH = 56;
    fillRound(mx + 8, contentY, mw - 16, sumH, 8, '#f5f5f5');
    // 三列：投入 / 中奖 / 净盈亏
    const colW = (mw - 16) / 3;
    const ty = contentY + 10;
    const cy = contentY + 32;
    text('累计投入', mx + 8 + colW * 0, ty, { size: 10, color: '#666', align: 'center' });
    text('累计中奖', mx + 8 + colW * 1, ty, { size: 10, color: '#666', align: 'center' });
    text('净盈亏',   mx + 8 + colW * 2, ty, { size: 10, color: '#666', align: 'center' });
    text(st.totalCost + ' 元',  mx + 8 + colW * 0, cy, { size: 14, weight: 'bold', color: '#333', align: 'center' });
    text(st.totalPrize + ' 元', mx + 8 + colW * 1, cy, { size: 14, weight: 'bold', color: '#4caf50', align: 'center' });
    const netColor = st.netPnL >= 0 ? '#e60012' : '#1976d2';
    const netText = (st.netPnL >= 0 ? '+' : '') + st.netPnL + ' 元';
    text(netText, mx + 8 + colW * 2, cy, { size: 14, weight: 'bold', color: netColor, align: 'center' });
    // 中奖率小字
    if (st.checkedCount > 0) {
      const winRate = (st.wonCount / st.checkedCount * 100).toFixed(0);
      text(`已对照 ${st.checkedCount} 张，中奖率 ${winRate}%`,
        mx + mw / 2, contentY + sumH - 6, { size: 9, color: '#999', align: 'center' });
    } else {
      text('还没对照过开奖结果', mx + mw / 2, contentY + sumH - 6, { size: 9, color: '#bbb', align: 'center' });
    }
    contentY += sumH + 6;
    contentH -= sumH + 6;
  }

  if (state.libraryView === 'list') {
    drawLibraryList(mx + 14, contentY, mw - 28, contentH);
  } else {
    drawLibraryDetail(mx + 14, contentY, mw - 28, contentH);
  }

  // 底部按钮行
  const btnY = my + mh - 50;
  const btnH = 36;
  const btnGap = 8;
  if (state.libraryView === 'list') {
    // 关闭 + 刷新 + 清空（三按钮）
    const third = (mw - 28 - btnGap * 2) / 3;
    // 关闭
    fillRound(mx + 14, btnY, third, btnH, 8, '#f5f5f5');
    text('关闭', mx + 14 + third / 2, btnY + (btnH - 14) / 2, { size: 13, color: '#333', align: 'center' });
    layoutY.libCloseX = mx + 14;
    layoutY.libCloseY = btnY;
    layoutY.libCloseW = third;
    layoutY.libCloseH = btnH;
    // 刷新
    const refreshTxt = state.refreshing ? '⏳  拉取中...' : '🔄  刷新';
    fillRound(mx + 14 + third + btnGap, btnY, third, btnH, 8, state.refreshing ? '#fff3e0' : '#fff');
    ctx.strokeStyle = state.refreshing ? '#ff8a00' : '#1976d2';
    ctx.lineWidth = 1;
    roundedRectPath(mx + 14 + third + btnGap + 0.5, btnY + 0.5, third - 1, btnH - 1, 7.5);
    ctx.stroke();
    text(refreshTxt, mx + 14 + third + btnGap + third / 2, btnY + (btnH - 14) / 2,
      { size: 12, weight: 'bold', color: state.refreshing ? '#ff8a00' : '#1976d2', align: 'center' });
    layoutY.libRefreshX = mx + 14 + third + btnGap;
    layoutY.libRefreshY = btnY;
    layoutY.libRefreshW = third;
    layoutY.libRefreshH = btnH;
    // 清空
    const clearEnabled = state.libraryList.length > 0;
    fillRound(mx + 14 + (third + btnGap) * 2, btnY, third, btnH, 8, clearEnabled ? '#fff' : '#f5f5f5');
    if (clearEnabled) {
      ctx.strokeStyle = '#e60012';
      ctx.lineWidth = 1;
      roundedRectPath(mx + 14 + (third + btnGap) * 2 + 0.5, btnY + 0.5, third - 1, btnH - 1, 7.5);
      ctx.stroke();
    }
    text('🗑  清空', mx + 14 + (third + btnGap) * 2 + third / 2, btnY + (btnH - 14) / 2,
      { size: 13, weight: 'bold', color: clearEnabled ? '#e60012' : '#bbb', align: 'center' });
    layoutY.libClearX = mx + 14 + (third + btnGap) * 2;
    layoutY.libClearY = btnY;
    layoutY.libClearW = third;
    layoutY.libClearH = btnH;
  } else {
    // 返回 + 删除 + 复制
    const third = (mw - 28 - btnGap * 2) / 3;
    fillRound(mx + 14, btnY, third, btnH, 8, '#f5f5f5');
    text('← 返回', mx + 14 + third / 2, btnY + (btnH - 14) / 2, { size: 13, color: '#333', align: 'center' });
    layoutY.libBackX = mx + 14;
    layoutY.libBackY = btnY;
    layoutY.libBackW = third;
    layoutY.libBackH = btnH;
    // 复制
    fillRound(mx + 14 + third + btnGap, btnY, third, btnH, 8, colorByLottery(library.get(state.librarySelectedId)?.lottery || 'ssq'));
    text('📋  复制', mx + 14 + third + btnGap + third / 2, btnY + (btnH - 14) / 2, { size: 13, weight: 'bold', color: '#fff', align: 'center' });
    layoutY.libCopyX = mx + 14 + third + btnGap;
    layoutY.libCopyY = btnY;
    layoutY.libCopyW = third;
    layoutY.libCopyH = btnH;
    // 删除
    fillRound(mx + 14 + (third + btnGap) * 2, btnY, third, btnH, 8, '#fff');
    ctx.strokeStyle = '#e60012';
    ctx.lineWidth = 1;
    roundedRectPath(mx + 14 + (third + btnGap) * 2 + 0.5, btnY + 0.5, third - 1, btnH - 1, 7.5);
    ctx.stroke();
    text('🗑  删除', mx + 14 + (third + btnGap) * 2 + third / 2, btnY + (btnH - 14) / 2, { size: 13, weight: 'bold', color: '#e60012', align: 'center' });
    layoutY.libDeleteX = mx + 14 + (third + btnGap) * 2;
    layoutY.libDeleteY = btnY;
    layoutY.libDeleteW = third;
    layoutY.libDeleteH = btnH;
  }
}

function drawLibraryList(x, y, w, h) {
  layoutY.libListX = x;
  layoutY.libListW = w;
  layoutY.libItemYs = [];
  const list = state.libraryList;
  if (!list || list.length === 0) {
    fillRound(x, y, w, 80, 8, '#f9f9f9');
    text('彩票库空空如也', x + w / 2, y + 24, { size: 14, weight: 'bold', color: '#999', align: 'center' });
    text('生成号码后点击「💾 保存到彩票库」', x + w / 2, y + 48, { size: 11, color: '#bbb', align: 'center' });
    layoutY.libraryScrollMax = 0;
    return;
  }
  // 渲染项（按滚动偏移）
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const rowH = 64;
  const gap = 8;
  let cy = y - state.libraryScrollY;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (cy + rowH < y || cy > y + h) {
      cy += rowH + gap;
      continue;
    }
    fillRound(x, cy, w, rowH, 8, '#fafafa');
    layoutY.libItemYs.push({ id: item.id, y: cy, h: rowH });
    // 左侧色条（已中奖变绿，未中变灰，待开奖保持彩种色）
    const lot = item.lottery === 'ssq' ? '#e60012' : '#ff6f00';
    let leftBar = lot;
    if (item.result) {
      leftBar = item.result.hitRank <= 8 ? '#4caf50' : '#bbb';
    }
    ctx.fillStyle = leftBar;
    ctx.fillRect(x + 4, cy + 8, 4, rowH - 16);
    // 标题行：彩票名 + 期号
    const lotName = item.lottery === 'ssq' ? '双色球' : '大乐透';
    text(lotName, x + 14, cy + 10, { size: 13, weight: 'bold', color: lot });
    const issueStr = item.issue ? `第 ${item.issue} 期` : '方案';
    text(issueStr, x + 80, cy + 10, { size: 11, color: '#666' });
    // 时间
    const d = new Date(item.savedAt);
    const timeStr = `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    text(timeStr, x + w - 14, cy + 10, { size: 10, color: '#999', align: 'right' });
    // 第二行：状态徽标 + 第一注预览
    let badge, badgeColor;
    if (item.result) {
      if (item.result.hitRank <= 8) {
        badge = `✓ ${item.result.hitLevel}`;
        badgeColor = '#4caf50';
      } else {
        badge = '✗ 未中奖';
        badgeColor = '#999';
      }
    } else {
      badge = '⏳ 待开奖';
      badgeColor = '#ff8a00';
    }
    text(badge, x + 14, cy + 32, { size: 11, weight: 'bold', color: badgeColor });
    if (item.bets && item.bets[0]) {
      const b0 = item.bets[0];
      const primStr = (b0.primary || []).slice(0, 3).map(n => pad(Number(n))).join(' ');
      const more = b0.primary && b0.primary.length > 3 ? `...` : '';
      text(`第 1 注 ${primStr}${more}`, x + 90, cy + 32, { size: 11, color: '#333' });
    }
    // 第三行：投入/奖金 + 点击提示
    let moneyLine = `${item.totalBets} 注  ·  投入 ${item.totalCost} 元`;
    if (item.result) {
      moneyLine += `  ·  奖金 ${item.result.prizeAmount} 元`;
    }
    moneyLine += '  ·  点击查看详情 →';
    text(moneyLine, x + 14, cy + 48, { size: 10, color: '#999' });
    cy += rowH + gap;
  }
  ctx.restore();
  layoutY.libraryScrollMax = Math.max(0, list.length * (rowH + gap) - h);
}

function drawLibraryDetail(x, y, w, h) {
  const item = library.get(state.librarySelectedId);
  if (!item) {
    fillRound(x, y, w, 80, 8, '#f9f9f9');
    text('未找到该票', x + w / 2, y + 32, { size: 14, color: '#999', align: 'center' });
    return;
  }
  // 头部信息
  const d = new Date(item.savedAt);
  const timeStr = `保存于 ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  text(timeStr, x, y, { size: 11, color: '#666' });
  const issueStr = item.issue ? `参考期号：${item.issue}` : '无期号';
  text(issueStr, x + w, y, { size: 11, color: '#666', align: 'right' });

  // 开奖对照结果（如果有）
  let resultH = 0;
  let cy = y + 18;
  if (item.result) {
    const r = item.result;
    const isWon = r.hitRank <= 8;
    const cardH = 50;
    fillRound(x, cy, w, cardH, 6, isWon ? '#e8f5e9' : '#f5f5f5');
    // 开奖号码
    const drawPrim = (r.primary || []).map(n => pad(Number(n))).join(' ');
    const drawSec = Array.isArray(r.secondary) ? r.secondary.map(n => pad(Number(n))).join(' ') : pad(Number(r.secondary));
    text(`开奖 ${r.issue} 期：`, x + 8, cy + 8, { size: 10, color: '#666' });
    text(drawPrim, x + 8, cy + 22, { size: 12, color: '#e60012', weight: 'bold' });
    text(drawSec, x + 8 + drawPrim.length * 7 + 8, cy + 22, { size: 12, color: '#1976d2', weight: 'bold' });
    // 命中等级
    const lvlColor = isWon ? '#4caf50' : '#999';
    const lvlText = isWon ? `✓ ${r.hitLevel}  +${r.prizeAmount} 元` : '✗ 未中奖';
    text(lvlText, x + w - 8, cy + 8, { size: 12, weight: 'bold', color: lvlColor, align: 'right' });
    text(`开奖日：${r.date || '-'}`, x + w - 8, cy + 30, { size: 9, color: '#999', align: 'right' });
    resultH = cardH + 8;
    cy += resultH;
  } else {
    fillRound(x, cy, w, 36, 6, '#fff8e1');
    text('⏳  还未开奖（启动时会自动联网对照）', x + w / 2, cy + 12, { size: 10, color: '#ff8a00', align: 'center' });
    resultH = 36 + 8;
    cy += resultH;
  }

  // 滚动内容（每注）
  const rowH = 52;
  const startY = cy;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, startY, w, h - (startY - y));
  ctx.clip();
  cy = startY - state.libraryScrollY;
  const lot = item.lottery === 'ssq' ? '#e60012' : '#ff6f00';
  // 每注：注号 + 号码 + 命中标记
  const perBetMap = {};
  if (item.result && item.result.perBet) {
    item.result.perBet.forEach(pb => { perBetMap[pb.index] = pb; });
  }
  for (let i = 0; i < item.bets.length; i++) {
    const b = item.bets[i];
    if (cy + rowH < startY || cy > startY + (h - (startY - y))) {
      cy += rowH + 4;
      continue;
    }
    const pb = perBetMap[b.index];
    const won = pb && pb.hitRank <= 8;
    fillRound(x, cy, w, rowH - 4, 4, won ? '#e8f5e9' : '#fafafa');
    text(`第 ${pad(b.index)} 注`, x + 6, cy + 4, { size: 11, color: lot, weight: 'bold' });
    const primStr = (b.primary || []).map(n => pad(Number(n))).join(' ');
    const secStr = Array.isArray(b.secondary)
      ? b.secondary.map(n => pad(Number(n))).join(' ')
      : pad(Number(b.secondary));
    text(primStr, x + 6, cy + 22, { size: 12, color: lot, weight: 'bold' });
    text(secStr, x + 6 + primStr.length * 7 + 6, cy + 22, { size: 12, color: '#1976d2', weight: 'bold' });
    // 右侧：命中等级（如果有 result）
    if (pb) {
      const lvlTxt = pb.hitRank <= 8 ? `${pb.hitLevel} +${pb.prizeAmount}` : '未中奖';
      const lvlCol = pb.hitRank <= 8 ? '#4caf50' : '#999';
      text(lvlTxt, x + w - 6, cy + 4, { size: 10, weight: 'bold', color: lvlCol, align: 'right' });
      text(`命中 ${pb.primaryHit}+${pb.secondaryHit}`, x + w - 6, cy + 22, { size: 9, color: '#999', align: 'right' });
    }
    cy += rowH;
  }
  // 合计
  cy += 8;
  let summary = `${item.totalBets} 注  ·  投入 ${item.totalCost} 元`;
  if (item.result) {
    const net = item.result.prizeAmount - item.totalCost;
    const netTxt = (net >= 0 ? '+' : '') + net;
    summary += `  ·  奖金 ${item.result.prizeAmount} 元  ·  净 ${netTxt} 元`;
  }
  text(summary, x, cy, { size: 11, color: '#666', weight: 'bold' });
  ctx.restore();
  layoutY.libraryScrollMax = Math.max(0, item.bets.length * rowH + 16 - (h - (startY - y)));
}

// ===== Toast =====
function showToast(msg, duration) {
  state.toastText = msg;
  state.toastUntil = Date.now() + (duration || 1500);
  markDirty();
}

function drawToast() {
  if (!state.toastText) return;
  if (Date.now() > state.toastUntil) {
    state.toastText = '';
    return;
  }
  const msg = state.toastText;
  ctx.font = '14px sans-serif';
  const w = ctx.measureText(msg).width + 36;
  const h = 36;
  const x = (W - w) / 2;
  const y = H - 80;
  ctx.globalAlpha = 0.92;
  fillRound(x, y, w, h, 18, 'rgba(0,0,0,0.78)');
  ctx.globalAlpha = 1;
  text(msg, W / 2, y + (h - 14) / 2, { size: 14, color: '#fff', align: 'center' });
  // 持续重绘直到 toast 结束
  setTimeout(markDirty, 200);
}

// ===== 启动时刷新彩票库计数 =====
function refreshLibraryCount() {
  try {
    state.libraryCount = library.stats().total;
  } catch (e) {
    state.libraryCount = 0;
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
    state.touchLastX = t.clientX;
    state.touchStartScroll = state.scrollY;
    state.touchStartTime = Date.now();
    state.scrollVelocity = 0;   // 重新触摸取消惯性
    if (_inertiaRAF) { cancelAnimationFrame(_inertiaRAF); _inertiaRAF = null; }
    // modal 打开时，尝试命中 modal 内的按钮
    if (state.showLibraryModal) {
      state.pressedBtn = _hitTestLibraryModal(t.clientX, t.clientY);
    } else {
      state.pressedBtn = _hitTestButtons(t.clientX, t.clientY);
    }
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
    const curX = t.clientX;
    const dy = curY - state.touchLastY;   // 上一帧增量
    state.touchLastY = curY;
    state.touchLastX = curX;
    if (Math.abs(curY - state.touchStartY) > 4) state.pressedBtn = null;
    // 彩票库 modal 打开时，滚 modal 内
    if (state.showLibraryModal) {
      // 滚动 modal 列表
      state.libraryScrollY -= dy;
      if (state.libraryScrollY < 0) state.libraryScrollY = 0;
      const libMax = layoutY.libraryScrollMax || 0;
      if (state.libraryScrollY > libMax) state.libraryScrollY = libMax;
      markDirty();
      return;
    }
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
    console.log('[TOUCH-END] pressedBtn=', state.pressedBtn && state.pressedBtn.kind || 'none', 'showLibraryModal=', state.showLibraryModal, 'currentBets=', state.currentBets.length);
    // 彩票库 modal 打开时：优先处理 modal 内的按钮
    if (state.showLibraryModal) {
      handleLibraryModalClick(state.pressedBtn, state.touchLastX, state.touchLastY);
      state.pressedBtn = null;
      state.scrollVelocity = 0;
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
        // 现在导出按钮只复制到粘贴板
        copyToClipboard();
      } else if (state.pressedBtn.kind === 'save') {
        saveCurrentToLibrary();
      } else if (state.pressedBtn.kind === 'library') {
        openLibraryModal();
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
refreshLibraryCount();
generate();
setupTouch();
loop();

// 启动后异步拉取最新开奖 + 对照库（不阻塞渲染）
function _bootstrapFetch() {
  state.latestDrawLoading = true;
  // 拉 SSQ
  network.fetchLatest('ssq').then(draw => {
    if (draw) {
      console.log('[BOOT] latest SSQ:', draw.issue);
      state.latestDraw.ssq = draw;
      markDirty();
      const r = library.checkAll({ ssq: draw });
      if (r.updated > 0) {
        showToast(`✓ 已对照 ${r.updated} 张票（最新 ${draw.issue}）`, 2000);
        state.libraryStats = library.stats();
        state.libraryCount = state.libraryStats.total;
        markDirty();
      }
    }
  }).catch(e => console.error('[BOOT] ssq fetch error', e));
  // 拉 DLT（cwl 可能返回空，失败也无所谓）
  network.fetchLatest('dlt').then(draw => {
    if (draw && draw.issue) {
      console.log('[BOOT] latest DLT:', draw.issue);
      state.latestDraw.dlt = draw;
      markDirty();
      const r = library.checkAll({ dlt: draw });
      if (r.updated > 0) {
        state.libraryStats = library.stats();
        state.libraryCount = state.libraryStats.total;
        markDirty();
      }
    }
  }).catch(e => console.error('[BOOT] dlt fetch error', e))
    .finally(() => {
      state.latestDrawLoading = false;
      markDirty();
    });
}
setTimeout(_bootstrapFetch, 1500);  // 等首屏画完再触发

wx.onShow(() => updateTime());
