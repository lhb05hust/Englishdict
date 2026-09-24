function rpxToPx(rpx) {
  const sysInfo = wx.getWindowInfo();
  return rpx * sysInfo.windowWidth / 750;
}

function pxToRpx(px) {
  const sysInfo = wx.getSystemInfoSync();
  return px * 750 / sysInfo.screenWidth;
}

function sleep(duration, callback) {
  setTimeout(() => {
    callback(null);
  }, duration);
}

/**
 * 节流函数（前缘触发）
 * 立即执行第一次，在 wait 毫秒内忽略后续调用，过了时间后允许下一次执行
 * @param {Function} fn 需要包装的函数
 * @param {Number} wait 等待时间（毫秒），默认 300
 */
function throttle(fn, wait = 300) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      return fn.apply(this, args); // 关键：保留 this 上下文
    }
  };
}

module.exports = { rpxToPx, pxToRpx, sleep, throttle};