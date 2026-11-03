/**
 * keepScreenUtil.js
 * ---------------------------------------------------------------------------
 * 听写场景「屏幕常亮」工具
 *
 * 作用：听写进行中阻止系统自动熄屏（自动锁屏 / 屏保），保证用户能连续
 *       完成整轮默写；听写结束后自动释放，不影响其他页面、不额外耗电。
 *
 * 能力边界（务必知悉）：
 *   1. 只能拦住「系统自动熄屏」，拦不住用户主动按电源键灭屏；
 *   2. 页面切到后台（含按电源键灭屏）时，微信会回收常亮锁，切回前台
 *      需要重新申请，本工具已自动处理；
 *   3. 手机开启低电量 / 省电模式时，系统可能强制回收常亮锁，本工具会
 *      给出提示，并可选地尝试提升屏幕亮度做兜底。
 *
 * 用法：
 *   const KeepScreenUtil = require('../../utils/keepScreenUtil.js')
 *
 *   onStartDictation() {
 *     KeepScreenUtil.start(this)   // 传入页面实例，自动接管生命周期
 *   }
 *   onDictationEnd() {
 *     KeepScreenUtil.stop()
 *   }
 * ---------------------------------------------------------------------------
 */

const DEFAULT_CONFIG = {
  // 是否在提示类场景弹 toast（关闭后仅打印日志，适合正式环境静默降级）
  showTip: true,
  // 低电量 / 省电模式时，是否尝试把屏幕亮度拉到最高做兜底
  // 注意：会明显增加耗电，默认关闭，按需开启
  raiseBrightnessOnLowPower: false,
  // 低电量时的提示文案
  lowPowerTip: '当前处于低电量模式，系统可能仍会自动熄屏',
  // 微信版本不支持该能力时的提示文案
  unsupportedTip: '当前微信版本不支持屏幕常亮，请注意不要手动熄屏',
  // 常亮开启失败时的提示文案
  failTip: '屏幕常亮开启失败，请注意不要熄屏',
};

const PAGE_HOOKS = ['onShow', 'onHide', 'onUnload'];

let config = Object.assign({}, DEFAULT_CONFIG);

// ---------------------------------------------------------------------------
// 内部状态
// ---------------------------------------------------------------------------
const state = {
  wantOn: false,            // 业务层期望的状态：是否正处于听写中
  page: null,               // 已接管的页面实例
  originals: {},            // 页面原始生命周期方法，用于还原
  supported: null,          // wx.setKeepScreenOn 兼容性检测结果缓存
  lastError: null,          // 最近一次失败原因，便于排查
  originBrightness: null,   // 兜底前的原始屏幕亮度
  brightnessRaised: false,  // 是否已通过提升亮度做兜底
  lowPowerNotified: false,  // 低电量提示是否已弹过，避免反复打扰
};

function log() {
  if (config.debug) {
    console.log.apply(console, ['[常亮工具]'].concat(Array.prototype.slice.call(arguments)));
  }
}

function toast(title) {
  if (!config.showTip || !title) return;
  if (typeof wx === 'undefined' || typeof wx.showToast !== 'function') return;
  wx.showToast({ title: title, icon: 'none', duration: 2500 });
}

// ---------------------------------------------------------------------------
// 基础能力
// ---------------------------------------------------------------------------
function isSupported() {
  if (state.supported === null) {
    try {
      state.supported =
        typeof wx !== 'undefined' &&
        typeof wx.setKeepScreenOn === 'function' &&
        (typeof wx.canIUse !== 'function' || wx.canIUse('setKeepScreenOn'));
    } catch (e) {
      state.supported = false;
    }
  }
  return state.supported;
}

/**
 * 申请 / 释放系统常亮锁
 * @return {Promise<boolean>} 是否成功
 */
function apply(on) {
  return new Promise(function (resolve) {
    if (!isSupported()) {
      state.lastError = 'wx.setKeepScreenOn 不可用';
      resolve(false);
      return;
    }
    wx.setKeepScreenOn({
      keepScreenOn: !!on,
      success: function () {
        if (on) state.lastError = null;
        log(on ? '常亮锁已申请' : '常亮锁已释放');
        resolve(true);
      },
      fail: function (err) {
        state.lastError = (err && (err.errMsg || err.errno)) || 'setKeepScreenOn 调用失败';
        console.warn('[常亮工具] 常亮设置失败：', state.lastError);
        resolve(false);
      },
    });
  });
}

// ---------------------------------------------------------------------------
// 屏幕亮度兜底（低电量模式下常亮锁可能被系统强制回收）
// ---------------------------------------------------------------------------
function getBrightness() {
  return new Promise(function (resolve) {
    if (typeof wx === 'undefined' || typeof wx.getScreenBrightness !== 'function') {
      resolve(null);
      return;
    }
    wx.getScreenBrightness({
      success: function (res) { resolve(typeof res.value === 'number' ? res.value : null); },
      fail: function () { resolve(null); },
    });
  });
}

function setBrightness(value) {
  return new Promise(function (resolve) {
    if (typeof wx === 'undefined' || typeof wx.setScreenBrightness !== 'function') {
      resolve(false);
      return;
    }
    wx.setScreenBrightness({
      value: value,
      success: function () { resolve(true); },
      fail: function () { resolve(false); },
    });
  });
}

function raiseBrightness() {
  getBrightness().then(function (value) {
    if (value === null) return;
    if (state.originBrightness === null) state.originBrightness = value;
    setBrightness(1).then(function (ok) {
      state.brightnessRaised = ok;
      log('亮度兜底：', ok ? '已提升至最高' : '失败');
    });
  });
}

function restoreBrightness() {
  if (!state.brightnessRaised || state.originBrightness === null) {
    state.originBrightness = null;
    return;
  }
  const value = state.originBrightness;
  state.brightnessRaised = false;
  state.originBrightness = null;
  setBrightness(value).then(function () { log('亮度兜底已恢复'); });
}

// ---------------------------------------------------------------------------
// 低电量检测
// ---------------------------------------------------------------------------
function checkLowPower() {
  let battery = null;
  try {
    if (typeof wx !== 'undefined' && typeof wx.getBatteryInfoSync === 'function') {
      battery = wx.getBatteryInfoSync();
    }
  } catch (e) {
    battery = null;
  }
  if (!battery) return;

  const level = typeof battery.level === 'number' ? battery.level : 100;
  const charging = battery.isCharging === true;
  const low = battery.isLowPowerMode === true || (level <= 20 && !charging);
  if (!low) return;

  if (!state.lowPowerNotified) {
    state.lowPowerNotified = true;
    toast(config.lowPowerTip);
  }
  if (config.raiseBrightnessOnLowPower) {
    raiseBrightness();
  }
}

// ---------------------------------------------------------------------------
// 页面生命周期接管：只包裹传入的这一个页面实例，不污染全局 Page 原型
// ---------------------------------------------------------------------------
function bindPage(page) {
  if (!page || state.page === page) return;
  unbindPage();
  state.page = page;

  PAGE_HOOKS.forEach(function (name) {
    state.originals[name] = page[name];
    page[name] = function () {
      let result;
      // 先执行页面自己的生命周期逻辑，不改变原有行为
      const original = state.originals[name];
      if (typeof original === 'function') {
        result = original.apply(this, arguments);
      }
      // 再做常亮处理，任何异常都不影响主流程
      try {
        if (name === 'onShow') {
          // 切回前台常亮锁已被系统回收，听写未结束则重新申请
          if (state.wantOn) apply(true);
        } else if (name === 'onHide') {
          // 页面不可见时常亮无意义，先释放省电
          apply(false);
        } else {
          // 页面卸载：彻底还原，避免残留与内存泄漏
          unbindPage();
          reset();
        }
      } catch (e) {
        console.warn('[常亮工具] 生命周期处理异常：', e);
      }
      return result;
    };
  });
  log('已接管页面生命周期');
}

function unbindPage() {
  const page = state.page;
  if (!page) return;
  PAGE_HOOKS.forEach(function (name) {
    if (typeof state.originals[name] !== 'undefined') {
      page[name] = state.originals[name];
    }
  });
  state.page = null;
  state.originals = {};
}

function reset() {
  state.wantOn = false;
  state.lowPowerNotified = false;
  restoreBrightness();
  apply(false);
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------
const KeepScreenUtil = {
  /**
   * 修改默认配置（可选，需在 start 之前调用）
   */
  init: function (options) {
    config = Object.assign({}, DEFAULT_CONFIG, options || {});
    return KeepScreenUtil;
  },

  /**
   * 是否支持屏幕常亮
   */
  isSupported: isSupported,

  /**
   * 开始听写：开启屏幕常亮
   * @param {Object} [page] 页面实例（页面里传 this 即可），传入后自动接管
   *                        生命周期，用户切后台再切回不会中途黑屏
   * @return {Promise<boolean>} 常亮是否开启成功（失败也不影响听写主流程）
   */
  start: function (page) {
    state.wantOn = true;
    if (page) bindPage(page);

    if (!isSupported()) {
      toast(config.unsupportedTip);
      return Promise.resolve(false);
    }
    return apply(true).then(function (ok) {
      if (ok) {
        checkLowPower();
      } else {
        toast(config.failTip);
      }
      return ok;
    });
  },

  /**
   * 结束听写：释放常亮锁并解绑生命周期
   */
  stop: function () {
    unbindPage();
    return Promise.resolve(reset());
  },

  /**
   * 手动暂停（未传 page 接管生命周期时使用，例如手动在 onHide 里调用）
   */
  pause: function () {
    return apply(false);
  },

  /**
   * 手动恢复（未传 page 接管生命周期时使用，例如手动在 onShow 里调用）
   */
  resume: function () {
    if (!state.wantOn) return Promise.resolve(false);
    return apply(true);
  },

  /**
   * 主动接管页面生命周期（等价于 start 时传入 page）
   */
  bindPage: bindPage,

  /**
   * 查看当前内部状态，便于排查问题
   */
  getState: function () {
    return {
      wantOn: state.wantOn,
      supported: isSupported(),
      lastError: state.lastError,
      boundPage: !!state.page,
      brightnessRaised: state.brightnessRaised,
    };
  },
};

module.exports = KeepScreenUtil;
