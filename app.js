const wordUtils = require('./utils/localStore');
App({
  globalData: {
    appName: "单词拍照听写",
    localUserId: "",
    // 本地调试填局域网IP，上线替换备案HTTPS域名
    //baseUrl: "http://47.119.191.99:8080",
    //baseUrl: "https://api.jhwin.cn",
    //baseUrl: "http://192.168.1.16:8080",
    baseUrl: "http://172.20.10.2:8080",
    
    tempImagePath: null,
    dictConfig: null,
    text2WIdMap: {},
    wId2TextMap: {},
  },
  onLaunch() {
    // 1. 读取/生成 localUserId
    this.ensureLocalUserId(); 
    // 2. 初始化 map
    this.initTextMap();
    // 3. 重写 wx API（顺序：先防抖，后 header）
    this.initFangDou();
    this.initRequestHeader();
  },
  // 生成随机设备ID
  createDevUUID() {
    return "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2,12);
  },
  initTextMap() {
    const words = wordUtils.getAllWords();
    const text2WIdMap = this.globalData.text2WIdMap;
    const wId2TextMap = this.globalData.wId2TextMap;
    //map初始化一次
    if (Object.keys(text2WIdMap).length === 0) {
      console.log("初始化全局2个map");
      for (const item of words) {
        //初始化2个全局映射
        text2WIdMap[item.text] = item.wordId;
        wId2TextMap[item.wordId] = item.text;
      }
    }
  },
  initFangDou() {
    const originalNavigateTo = wx.navigateTo;
    const originalRedirectTo = wx.redirectTo;
    let lastNavigateTime = 0;
    let lastRedirectTime = 0;
  
    wx.navigateTo = function (options) {
      const now = Date.now();
      if (now - lastNavigateTime < 1000) return;
      lastNavigateTime = now;
      return originalNavigateTo.call(wx, options);
    };
  
    wx.redirectTo = function (options) {
      const now = Date.now();
      if (now - lastRedirectTime < 1000) return;
      lastRedirectTime = now;
      return originalRedirectTo.call(wx, options);
    };
  },
  initRequestHeader() {
    const app = this;                        // ← 保存 this 引用
    const originalRequest = wx.request;
    wx.request = function (options) {
      if (options.url && options.url.startsWith(app.globalData.baseUrl)) {
        options.header = options.header || {};
        if (!options.header['local-user-id']) {
          options.header['local-user-id'] = app.ensureLocalUserId();
        }
      }
      return originalRequest.call(wx, options);
    };
  },
  ensureLocalUserId() {
    if (this.globalData.localUserId) return this.globalData.localUserId;
    let uid = wx.getStorageSync("localUserId");
    if (!uid) {
      uid = this.createDevUUID();
      try { wx.setStorageSync("localUserId", uid); } catch (e) {}
    }
    this.globalData.localUserId = uid;
    return uid;
  }
});