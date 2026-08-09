/**
 * 网络工具 - 实时拉取彩票开奖数据
 *
 * 数据源：
 *   SSQ: 中国福利彩票官方 API (cwl.gov.cn)
 *        https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=N
 *   DLT: cwl.gov.cn 没有 DLT 接口（DLT 属于体彩），所以联网大概率失败；
 *        直接用本地打包的历史数据作为兜底（local history，靠 GitHub Actions 每天更新）。
 *
 * 注意：微信小游戏有「request 合法域名」限制，需在 mp.weixin.qq.com 后台配置：
 *   request 合法域名：https://www.cwl.gov.cn
 *   如未配置，request 会 fail，函数会自动回退到本地历史（不阻塞 app 启动）
 *
 * 缓存策略：最近一次拉取结果 + 时间戳存到 storage（key: cp_latest_<lottery>）
 *   - 启动时先读缓存：6 小时内不重复拉取
 *   - 超过 6 小时才重新请求
 *   - 网络失败 / API 失败 / 缓存过期：依次回退
 *     1) 缓存  2) 本地历史数据（data/ssq_history.js / dlt_history.js）
 */

const CACHE_PREFIX = 'cp_latest_';
const CACHE_TTL_MS = 60 * 1000;  // 60 秒（让定时刷新能拿到最新）

// 实际请求时再拼接时间戳，避免 cdn / wx.request 缓存
const SSQ_URL_BASE = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=1';
const DLT_URL_BASE = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=dlt&issueCount=1';
function _bypass(url) {
  // 加随机 _t 参数，每次请求 URL 都不同，强制所有层缓存失效
  return url + '&_t=' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
}

function _readCache(lottery) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(CACHE_PREFIX + lottery);
      if (v && typeof v === 'object' && v.fetchedAt) return v;
    }
  } catch (e) {
    console.error('[network] read cache error', e);
  }
  return null;
}

function _writeCache(lottery, data) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(CACHE_PREFIX + lottery, {
        ...data,
        fetchedAt: Date.now()
      });
      return true;
    }
  } catch (e) {
    console.error('[network] write cache error', e);
  }
  return false;
}

function _request(url) {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
      console.warn('[network] wx.request 不可用');
      resolve({ _noReason: 'wx_unavailable' });
      return;
    }
    wx.request({
      url,
      method: 'GET',
      timeout: 5000,
      header: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          if (res.data.state === 0 && Array.isArray(res.data.result) && res.data.result.length > 0) {
            resolve(res.data);
            return;
          }
        }
        console.warn('[network] request failed', res.statusCode, res.data && res.data.message);
        resolve({ _noReason: 'bad_status', statusCode: res.statusCode });
      },
      fail: (err) => {
        console.warn('[network] request error', err && err.errMsg);
        // errMsg 含 'url not in domain list' = 域名没加白名单
        const errMsg = err && err.errMsg || '';
        let reason = 'network_error';
        if (errMsg.includes('url not in domain list')) {
          reason = 'domain_not_whitelisted';
        } else if (errMsg.includes('timeout')) {
          reason = 'timeout';
        }
        resolve({ _noReason: reason, errMsg: errMsg });
      }
    });
  });
}

// 错误原因 → 用户友好提示
function _reasonToMessage(reason) {
  switch (reason) {
    case 'domain_not_whitelisted':
      return '⚠️ 域名未加白名单：mp.weixin.qq.com → 开发管理 → request 合法域名 → 加 https://www.cwl.gov.cn';
    case 'timeout':
      return '⚠️ 网络超时，请检查网络';
    case 'bad_status':
      return '⚠️ 服务器返回错误，请稍后重试';
    case 'wx_unavailable':
      return '⚠️ wx.request 不可用';
    case 'network_error':
    default:
      return '⚠️ 联网失败，请检查网络或域名配置';
  }
}

function _parseSSQ(item) {
  if (!item) return null;
  return {
    lottery: 'ssq',
    issue: item.code,
    date: item.date ? item.date.split('(')[0].trim() : '',
    primary: String(item.red || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)),
    secondary: parseInt(item.blue, 10) || 0,
  };
}

function _parseDLT(item) {
  if (!item) return null;
  // cwl.gov.cn 的 DLT 字段可能跟 SSQ 不同，保守处理
  return {
    lottery: 'dlt',
    issue: item.code,
    date: item.date ? item.date.split('(')[0].trim() : '',
    primary: String(item.front || item.red || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)),
    secondary: String(item.back || item.blue || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)),
  };
}

/**
 * 本地历史回退：直接读打包的 data/ssq_history.js / dlt_history.js，取最新一期
 * 返回: {lottery, issue, date, primary, secondary} 或 null
 */
/**
 * 比较两个期号哪个更新（返回 true 表示 a 比 b 新）
 * SSQ: 7 位数字，直接比大小
 * DLT: 5 位数字（前 2 位是年份后 2 位），直接比大小
 */
function _isNewerIssue(lottery, a, b) {
  if (!a || !b) return false;
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  return !isNaN(na) && !isNaN(nb) && na > nb;
}

function _fallbackFromHistory(lottery) {
  try {
    const history = require('./history.js');
    const draws = history.loadHistory(lottery);
    if (!draws || draws.length === 0) return null;
    const latest = draws[draws.length - 1];
    return {
      lottery,
      issue: latest.issue,
      date: latest.date,
      primary: latest.primary,
      secondary: latest.secondary,
    };
  } catch (e) {
    console.error('[network] local history fallback error', e);
    return null;
  }
}

/**
 * 拉取最新一期（带缓存 + 本地兜底）
 * 返回: {lottery, issue, date, primary, secondary} 或 null
 */
async function fetchLatest(lottery, opts) {
  const useCache = !opts || opts.useCache !== false;
  // 1) 读缓存：但如果本地历史已有更新期号，优先用本地（避免缓存里旧的期号）
  if (useCache) {
    const cached = _readCache(lottery);
    if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
      const { fetchedAt, ...cachedData } = cached;
      // 检查本地历史是否有更新的期号
      const localDraw = _fallbackFromHistory(lottery);
      if (localDraw && cachedData.issue && _isNewerIssue(lottery, localDraw.issue, cachedData.issue)) {
        console.log('[network] local has newer', lottery, localDraw.issue, '> cache', cachedData.issue);
        _writeCache(lottery, localDraw);
        return localDraw;
      }
      console.log('[network] use cached', lottery, cachedData.issue);
      return cachedData;
    }
  }
  // 2) 联网拉取
  const url = lottery === 'ssq' ? SSQ_URL_BASE : DLT_URL_BASE;
  const parser = lottery === 'ssq' ? _parseSSQ : _parseDLT;
  console.log('[network] fetching', lottery, url);
  const resp = await _request(_bypass(url));
  if (resp && resp.result && resp.result.length > 0) {
    const parsed = parser(resp.result[0]);
    if (parsed && parsed.issue) {
      _writeCache(lottery, parsed);
      return parsed;
    }
  }
  // 失败时连同原因一起返回（让上层能区分"域名没加" vs "网络问题"）
  // DLT 特殊处理：cwl 没 DLT 接口，永远网络上拉不到 → 静默 fallback 到本地
  if (resp && resp._noReason) {
    if (lottery === 'dlt') {
      // DLT 跳过错误返回，直接走下面的本地 fallback
      console.log('[network] DLT network failed, silently falling back to local');
    } else {
      return { _error: true, reason: resp._noReason, message: _reasonToMessage(resp._noReason), errMsg: resp.errMsg };
    }
  }
  // 3) API 失败：回退到缓存（即使过期也用）
  const cached = _readCache(lottery);
  if (cached) {
    const { fetchedAt, ...dataOnly } = cached;
    return dataOnly;
  }
  // 4) 缓存也没有：回退到本地历史数据
  const localDraw = _fallbackFromHistory(lottery);
  if (localDraw) {
    // DLT 静默 fallback（cwl 没 DLT 接口，本地 GitHub Actions 每日同步），不打印 warn
    if (lottery !== 'dlt') console.warn('[network] no cache, falling back to local history');
    _writeCache(lottery, localDraw);
  }
  return localDraw;
}

/**
 * 强制刷新（忽略缓存，重新联网，本地兜底）
 */
async function fetchLatestForce(lottery) {
  return fetchLatest(lottery, { useCache: false });
}

/**
 * 清缓存（手动）
 */
function clearCache(lottery) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.removeStorageSync === 'function') {
      wx.removeStorageSync(CACHE_PREFIX + lottery);
      return true;
    }
  } catch (e) {
    console.error('[network] clear cache error', e);
  }
  return false;
}

module.exports = {
  fetchLatest,
  fetchLatestForce,
  clearCache,
};
