// pages/result/result.js
const wordUtils = require('../../utils/localStore');

Page({
  data: {
    wordList: [],
    errCount: 0,
    timeDisplay: '',
    bFromPlay: false,
  },

  onReady() {
    const dictConfig = getApp().globalData.dictConfig;
    if (!dictConfig || !dictConfig.wordList || dictConfig.wordList.length === 0) {
      wx.showToast({ title: "没有听写词语", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    // 【新增1】把 rId 存到页面实例上，供后续同步使用
    this.rId = dictConfig.rId || '';
    setTimeout(() => {
      let { wordList, errWids, errCount, timeDisplay } = dictConfig;
      let list = [...wordList];
      let bFromPlay = false;
      
      // 从 play 页跳过来，没有 timeDisplay，且有 errWids
      if (!timeDisplay && errWids) {
        errCount = errWids.length;
        bFromPlay = true;
      }
      
      const initList = list.map((item, idx) => {
        const tid = wordUtils.getWordId(item.text);
        // 如果是线上逻辑从记录页来，直接读 item.isErr
        let isWrongW = bFromPlay ? errWids.includes(tid) : item.isErr;
        return {
          ...item,
          wordId: tid,
          isErr: isWrongW,
        };
      });
      this.setData({ wordList: initList, errCount: errCount, bFromPlay: bFromPlay, timeDisplay: timeDisplay });
    }, 0);
  },

  onHide() {
    this.syncRecord();
  },

  onUnload() {
    this.syncRecord();
    getApp().globalData.dictConfig = null;
  },

  markErr(e) {
    const id = e.currentTarget.dataset.id;
    const res = wordUtils.addWrongWord(id);
    // 【修复】判断 res.success 而不是直接判断 res 对象
    if (res && res.success) {
      const index = this.data.wordList.findIndex(item => item.wordId === id);
      if (index !== -1) {
        this.setData({
          [`wordList[${index}].isErr`]: true,
          errCount: this.data.errCount + 1
        });
        wx.showToast({
          title: '词语"' + this.data.wordList[index].text + '"已加入错题本',
          icon: 'none'
        });
      }
    } else {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  unMarkErr(e) {
    const id = e.currentTarget.dataset.id;
    const res = wordUtils.removeWrongWord(id);
    const index = this.data.wordList.findIndex(item => item.wordId === id);
    // 【修复】判断 res.success
    if (res && res.success && index !== -1) {
      this.setData({
        [`wordList[${index}].isErr`]: false,
        errCount: this.data.errCount - 1
      });
      wx.showToast({
        title: '词语"' + this.data.wordList[index].text + '"已移出错题本',
        icon: 'none'
      });
    }
  },

  onRedictErrs() {
    let errWords = this.data.wordList.filter(item => item.isErr);
    let text = "本页暂无错词哦";
    if (this.data.bFromPlay) {
      text = "本页暂无错词哦，请标错后再试试";
    }
    if (errWords.length === 0) {
      wx.showToast({ title: text, duration: 2500, icon: 'none' });
      return;
    }
    const list = errWords.map(item => ({ en: item.text, cn: item.cn || '' }));
    // 重听错词：不传 rId，作为独立的新任务
    wx.redirectTo({
      url: `/pages/dictation/dictation?words=${JSON.stringify(list)}`
    });
  },

  onRedictAll() {
    const list = this.data.wordList.map(item => ({ en: item.text, cn: item.cn || '' }));
    // 重听 = 新开一轮，不传 rId，不污染原记录
    wx.redirectTo({
      url: `/pages/dictation/dictation?words=${JSON.stringify(list)}`
    });
  },

  onShareAppMessage(res) {
    return { title: getApp().globalData.appName, path: "/pages/index/index" }
  },
  onShareTimeline() {
    return { title: getApp().globalData.appName, query: "" }
  },
  syncRecord() {
    if (!this.rId) return;
    // 因为这里是在 record.js 或 index.js 跳转过来的，本地缓存必定已经存在
    const recordsMap = wx.getStorageSync("dict_records") || {};
    const record = recordsMap[this.rId];
    if (record) {
      record.wordList = this.data.wordList;
      record.errCount = this.data.errCount;
      wx.setStorageSync("dict_records", recordsMap);
    }
  },
})