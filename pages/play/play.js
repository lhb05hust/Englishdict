const app = getApp();
const tts = require("../../utils/tts");
const lStore = require("../../utils/localStore");
const { throttle } = require("../../utils/tool");
const KeepScreenUtil = require("../../utils/keepScreenUtil");
KeepScreenUtil.init({ showTip: false });

const STATUS_PLAYING = 1;
const STATUS_PREPARE_NEXT_ROUND = 2;
const STATUS_GAP = 3;

let requestVersion = 0;

Page({
  data: {
    playStatus: "running",
    dictWordList: [],
    errWids: [],
    totalCount: 0,
    gapSecond: 5,
    readRoundTotal: 2,
    currentWordIndex: 0,
    currentReadRound: 1,
    subStatus: STATUS_PLAYING,
    subStatusText: "",
    showWord: false,
    showCn: false,
    currentWord: {},
    rId: "", // 保存当前任务 ID
  },

  _timer: null,

  getSubStatusText(status, currentRound, totalRound) {
    const suffix = ` · 第${currentRound}/${totalRound}遍`;
    switch (status) {
      case STATUS_PLAYING: return "正在报读" + suffix;
      case STATUS_PREPARE_NEXT_ROUND: return "准备下一遍" + suffix;
      case STATUS_GAP: return "间隔中" + suffix;
      default: return "";
    }
  },

  onLoad() {
    this.prevWord = throttle(this.prevWord, 500);
    this.nextWord = throttle(this.nextWord, 500);
    this.togglePause = throttle(this.togglePause, 500);
    this.add2ErrBook = throttle(this.add2ErrBook, 500);

    const dictConfig = app.globalData.dictConfig;
    if (!dictConfig || !dictConfig.wordList || dictConfig.wordList.length === 0) {
      wx.showToast({ title: "没有待听写单词", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    let { wordList, readOrder, readTimes, gap, takeCount, rId } = dictConfig;
    let list = [...wordList];
    if (takeCount < list.length) {
      list = list.slice(0, takeCount);
    }

    if (readOrder === "random") {
      list.sort(() => Math.random() - 0.5);
    }

    const initSubStatus = STATUS_PLAYING;
    const initText = this.getSubStatusText(initSubStatus, 1, readTimes);

    this.setData({
      dictWordList: list,
      totalCount: list.length,
      gapSecond: gap,
      readRoundTotal: readTimes,
      currentWordIndex: 0, // 永远从 0 开始
      currentReadRound: 1,
      playStatus: "running",
      showWord: false,
      showCn: false,
      subStatus: initSubStatus,
      subStatusText: initText,
      currentWord: list[0],
      errWids: [],
      rId: rId || "",
    }, () => {
      KeepScreenUtil.start(this);
      setTimeout(() => {
        this.runDictFlow();
      }, 300);
    });
  },

  runDictFlow() {
    if (this.data.playStatus === "paused") return;
    const { subStatus, currentReadRound, readRoundTotal, currentWord } = this.data;

    switch (subStatus) {
      case STATUS_PLAYING: {
        const currentVersion = requestVersion;
        tts.stopSpeak();

        const onSpeakDone = (err) => {
          if (this.data.playStatus === "paused" || currentVersion !== requestVersion) return;
          if (err) console.warn("TTS播报出错");

          if (currentReadRound < readRoundTotal) {
            const newStatus = STATUS_PREPARE_NEXT_ROUND;
            this.setData({ subStatus: newStatus, subStatusText: this.getSubStatusText(newStatus, currentReadRound, readRoundTotal) }, () => {
              this.runDictFlow();
            });
          } else {
            const newStatus = STATUS_GAP;
            this.setData({ subStatus: newStatus, subStatusText: this.getSubStatusText(newStatus, currentReadRound, readRoundTotal) }, () => {
              this.runDictFlow();
            });
          }
        };

        tts.speakWord(currentWord.text, onSpeakDone);
        break;
      }

      case STATUS_PREPARE_NEXT_ROUND: {
        if (!this._timer) {
          this._timer = setTimeout(() => {
            this._timer = null;
            const nextRound = currentReadRound + 1;
            const newStatus = STATUS_PLAYING;
            this.setData({ currentReadRound: nextRound, subStatus: newStatus, subStatusText: this.getSubStatusText(newStatus, nextRound, readRoundTotal) }, () => {
              this.runDictFlow();
            });
          }, this.data.gapSecond * 1000);
        }
        break;
      }

      case STATUS_GAP: {
        if (!this._timer) {
          this._timer = setTimeout(() => {
            this._timer = null;
            this.gotoNextWord();
          }, this.data.gapSecond * 1000);
        }
        break;
      }
    }
  },

  gotoNextWord() {
    this.clearAllTimer();
    requestVersion++;
    tts.stopSpeak();

    const nextIdx = this.data.currentWordIndex + 1;
    if (nextIdx >= this.data.dictWordList.length) {
      if (this.data.rId) {
        const finalList = this.data.dictWordList.map(item => {
          const tid = lStore.getWordId(item.text);
          return { ...item, isErr: this.data.errWids.includes(tid) };
        });
        lStore.updateDictRecord(this.data.rId, this.data.errWids.length, 'completed', finalList);
      }
      tts.speakFinish();
      KeepScreenUtil.stop();
      wx.showModal({
        title: "听写结束🎉，请检查",
        content: "单词听写完毕,点”确定“进行检查",
        showCancel: false,
        success: () => {
          getApp().globalData.dictConfig = {
            wordList: this.data.dictWordList,
            errWids: this.data.errWids,
            time: Date.now(),
            rId: this.data.rId, 
          }
          wx.reLaunch({ url: `/pages/result/result` });
        }
      });
      return;
    }
    const newStatus = STATUS_PLAYING;
    this.setData({
      currentWordIndex: nextIdx,
      currentReadRound: 1,
      subStatus: newStatus,
      subStatusText: this.getSubStatusText(newStatus, 1, this.data.readRoundTotal),
      showWord: false,
      showCn: false,
      currentWord: this.data.dictWordList[nextIdx]
    }, () => this.runDictFlow());
  },

  prevWord() {
    this.clearAllTimer();
    requestVersion++;
    tts.stopSpeak();

    let idx = this.data.currentWordIndex - 1;
    if (idx < 0) idx = 0;
    const newStatus = STATUS_PLAYING;
    this.setData({
      currentWordIndex: idx,
      currentReadRound: 1,
      subStatus: newStatus,
      subStatusText: this.getSubStatusText(newStatus, 1, this.data.readRoundTotal),
      showWord: false,
      showCn: false,
      currentWord: this.data.dictWordList[idx],
      playStatus: "running"
    }, () => this.runDictFlow());
  },

  nextWord() {
    this.clearAllTimer();
    this.setData({ playStatus: "running" }, () => { this.gotoNextWord(); });
  },

  togglePause() {
    if (this.data.playStatus === "running") {
      this.clearAllTimer();
      tts.stopSpeak();
      this.setData({ playStatus: "paused" });
    } else {
      this.setData({ playStatus: "running" }, () => { this.runDictFlow(); });
    }
  },

  toggleShowCn() { this.setData({ showCn: !this.data.showCn }); },
  toggleShowWord() { this.setData({ showWord: !this.data.showWord }); },

  add2ErrBook() {
    const errword = this.data.currentWord;
    const wid = lStore.getWordId(errword.text);

    if (this.data.errWids.includes(wid)) {
      wx.showToast({ title: '词语"' + errword.text + '"已在错题本', icon: 'none' });
      this.nextWord();
      return;
    }

    lStore.addWrongWord(wid);
    this.setData({ errWids: [...this.data.errWids, wid] });
    wx.showToast({ title: '✅词语"' + errword.text + '"已加入错题本', icon: 'none' });
    this.nextWord();
  },

  editCurrentWord() {
    wx.showModal({
      title: "即将返回并修改单词",
      content: "确定要结束本次听写吗？",
      success: res => {
        if (res.confirm) {
          this.clearAllTimer();
          requestVersion++;
          tts.stopSpeak();
          wx.navigateBack();
        }
      }
    });
  },

  confirmFinish() {
    wx.showModal({
      title: "结束听写",
      content: "确定要结束本次听写吗？",
      success: res => {
        if (res.confirm) {
          if (this.data.rId) {
            // 只更新 errCount，不传 finalList：
            // ongoing 记录的 wordList 保持 dictation 写入的完整词表，
            // 避免 takeCount < total 时未听的词被 slice 后的列表覆盖丢失。
            lStore.updateDictRecord(this.data.rId, this.data.errWids.length, 'ongoing');
          }
          this.clearAllTimer();
          requestVersion++;
          tts.stopSpeak();
          wx.reLaunch({ url: '/pages/index/index' });
        }
      }
    });
  },

  clearAllTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  },

  onUnload() {
    KeepScreenUtil.stop();
    this.clearAllTimer();
    requestVersion++;
    tts.stopSpeak();
  },

  onShareAppMessage(res) { return { title: getApp().globalData.appName, path: "/pages/index/index" }; },
  onShareTimeline() { return { title: getApp().globalData.appName, query: "" }; },
});