/**
 * 随机数工具
 *
 * 优先使用 wx.getRandomValues()（密码学安全，对应 Python 的 SystemRandom）
 * 不可用时回退到 Math.random
 */

function secureSample(pool, k) {
  // 密码学安全的无重复抽样（Fisher-Yates with crypto shuffle）
  const arr = pool.slice();
  const n = arr.length;
  if (k > n) throw new Error("k cannot exceed pool size");
  // 生成 n 个随机 32 位整数
  const buf = new Uint32Array(n);
  if (typeof wx !== "undefined" && wx.getRandomValues) {
    wx.getRandomValues(buf);
  } else if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 0xffffffff);
  }
  // Fisher-Yates 洗牌，只洗前 k 个
  for (let i = 0; i < k; i++) {
    const r = buf[i] / 0x100000000;
    const j = i + Math.floor(r * (n - i));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr.slice(0, k);
}

function secureInt(min, max) {
  // [min, max] 闭区间
  const range = max - min + 1;
  if (typeof wx !== "undefined" && wx.getRandomValues) {
    const buf = new Uint32Array(1);
    wx.getRandomValues(buf);
    return min + (buf[0] % range);
  }
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return min + (buf[0] % range);
  }
  return min + Math.floor(Math.random() * range);
}

function secureChoice(arr) {
  return arr[secureInt(0, arr.length - 1)];
}

module.exports = {
  secureSample,
  secureInt,
  secureChoice,
};
