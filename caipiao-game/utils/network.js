/**
 * 网络工具 - 实时拉取彩票开奖数据
 *
 * 数据源：中国福利彩票官方 API (cwl.gov.cn)
 *   SSQ: https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=N
 *   DLT: 体彩官方 API（暂用 cwl fallback，未必稳定）
 *
 * 注意：微信小游戏有「request 合法域名」限制，需在 mp.weixin.qq.com 后台配置：
 *   request 合法域名：https://www.cwl.gov.cn
 *   如未配置，request 会 fail，函数返回 null（不阻塞 app 启动）
 *
 * 缓存策略：最近一次拉取结果 + 时间戳存到 storage（key: cp_latest_<lottery>）
 *   - 启动时先读缓存：6 小时内不重复拉取
 *   - 超过 6 小时才重新请求
 *   - 网络失败时使用缓存（不报错）
 */

const CACHE_PREFIX = 'cp_latest_';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 小时

const SSQ_URL = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=1';
const DLT_URL = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=dlt&issueCount=1';

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
      resolve(null);
      return;
    }
    wx.request({
      url,
      method: 'GET',
      timeout: 5000,
      header: {
        'Content-Type': 'application/json',
      },
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          if (res.data.state === 0 && Array.isArray(res.data.result) && res.data.result.length > 0) {
            resolve(res.data);
            return;
          }
        }
        console.warn('[network] request failed', res.statusCode, res.data && res.data.message);
        resolve(null);
      },
      fail: (err) => {
        console.warn('[network] request error', err && err.errMsg);
        resolve(null);
      }
    });
  });
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
 * 拉取最新一期（带缓存）
 * 返回: {lottery, issue, date, primary, secondary} 或 null
 */
async function fetchLatest(lottery, opts) {
  const useCache = !opts || opts.useCache !== false;
  // 1) 读缓存
  if (useCache) {
    const cached = _readCache(lottery);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
      console.log('[network] use cached', lottery, cached.issue);
      return cached.data || null;
    }
  }
  // 2) 联网拉取
  const url = lottery === 'ssq' ? SSQ_URL : DLT_URL;
  const parser = lottery === 'ssq' ? _parseSSQ : _parseDLT;
  console.log('[network] fetching', lottery, url);
  const resp = await _request(url);
  if (!resp || !resp.result || resp.result.length === 0) {
    console.warn('[network] no data, falling back to cache');
    const cached = _readCache(lottery);
    return (cached && cached.data) || null;
  }
  const parsed = parser(resp.result[0]);
  if (parsed && parsed.issue) {
    _writeCache(lottery, parsed);
  }
  return parsed;
}

/**
 * 强制刷新（忽略缓存）
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
