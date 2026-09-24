const wordUtils = require('./utils/localStore');
App({
  globalData: {
    appName: "英语听写小帮手",
    localUserId: "",
    // 本地调试填局域网IP，上线替换备案HTTPS域名
    //baseUrl: "http://47.119.191.99:8080",
    //baseUrl: "https://api.jhwin.cn",
    //baseUrl: "http://192.168.1.7:8080",
    baseUrl: "http://172.20.10.2:8080",
    
    tempImagePath: null,
    dictConfig: null,
    text2WIdMap: {},
    wId2TextMap: {},
  },
  onLaunch() {
    // 读取本地存储唯一设备标识
    let uid = wx.getStorageSync("localUserId");
    if (!uid) {
      uid = this.createDevUUID();
      wx.setStorageSync("localUserId", uid);
    }
    this.globalData.localUserId = uid;

    this.initTextMap();
    this.initFangDou();
  },
  // 生成随机设备ID
  createDevUUID() {
    return "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2,12);
  },
  initTextMap() {
    const words = wordUtils.getAllWords();
    //debugger; 
    console.log(words);
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
  }
});