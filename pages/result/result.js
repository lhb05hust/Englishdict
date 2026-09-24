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
      wx.showToast({ title: "没有听写单词", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    setTimeout(() => {
      let { wordList, errWids, errCount, timeDisplay } = dictConfig;
      let list = [...wordList];
      let bFromPlay = false;
      if (errWids) {//play页面跳转过来会传这个字段
        errCount = errWids.length;
        bFromPlay = true;
      }
      const initList = list.map((item, idx) => {
        const tid = wordUtils.getWordId(item.text);
        let isWrongW = bFromPlay ? errWids.includes(tid) : item.isErr;
        return {
          ...item,
          wordId: tid,
          isErr: isWrongW,
        };
      });
      this.setData({ wordList: initList, errCount: errCount, bFromPlay: bFromPlay, timeDisplay: timeDisplay });
      console.log(Date.now());
    }, 0);
  },

  markErr(e) {
    const id = e.currentTarget.dataset.id;
    const res = wordUtils.addWrongWord(id);
    if (res && res.success) {
      const index = this.data.wordList.findIndex(item => item.wordId === id);
      if (index !== -1) {
        this.setData({
          [`wordList[${index}].isErr`]: true,
          errCount: this.data.errCount + 1
        });
        wx.showToast({
          title: '单词"' + this.data.wordList[index].text + '"已加入错题本',
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
    if (res && res.success && index !== -1) {
      this.setData({
        [`wordList[${index}].isErr`]: false,
        errCount: this.data.errCount - 1
      });

      wx.showToast({
        title: '单词"' + this.data.wordList[index].text + '"已移出错题本',
        icon: 'none'
      });
    }
  },

  //确认并开始启动专项听写
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
    wx.redirectTo({
      url: `/pages/dictation/dictation?words=${JSON.stringify(list)}`
    });
  },

  //重听所有
  onRedictAll() {
    const list = this.data.wordList.map(item => ({ en: item.text, cn: item.cn || '' }));
    wx.redirectTo({
      url: `/pages/dictation/dictation?words=${JSON.stringify(list)}`
    });
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    if (this.data.bFromPlay) {
      let { wordList, errCount } = this.data;
      setTimeout(() => {
        wordUtils.addDictRecord(wordList, errCount);
      }, 10);
    }
    getApp().globalData.dictConfig = null;
  },

  onShareAppMessage(res) {
    return {
      title: getApp().globalData.appName,
      path: "/pages/index/index"
    }
  },
  onShareTimeline() {
    return {
      title: getApp().globalData.appName,
      query: ""
    }
  },

})