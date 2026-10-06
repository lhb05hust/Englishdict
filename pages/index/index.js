const lStore = require("../../utils/localStore");

// ============ 英语版显示文案映射 ============
const EN_VER_LABELS = {
  rjb:  '人教版',
  wyb:  '外研版',
  ylb:  '译林版',
  bsdb: '北师大版',
  hjb:  '沪教版',
  jkb:  '教科版',
};

const EN_GRADE_LABELS = {
  p3: '三年级', p4: '四年级', p5: '五年级', p6: '六年级',
  j7: '七年级', j8: '八年级', j9: '九年级',
  senior: '高中',
};

const EN_SENIOR_BOOK_LABELS = {
  bx1: '必修1', bx2: '必修2', bx3: '必修3',
  xb1: '选必1', xb2: '选必2', xb3: '选必3', xb4: '选必4',
};

// 把 getEnSelected() 的三字段拼成显示文案
// 例："人教版 · 高中必修3"
function buildLastTextbookText(saved) {
  if (!saved || !saved.grade || !saved.ver || !saved.bid) return '';
  const verLabel = EN_VER_LABELS[saved.ver] || saved.ver;
  const gradeLabel = EN_GRADE_LABELS[saved.grade] || saved.grade;

  let bookLabel = '';
  if (EN_SENIOR_BOOK_LABELS[saved.bid]) {
    bookLabel = EN_SENIOR_BOOK_LABELS[saved.bid];
  } else {
    const term = saved.bid.slice(-1);
    bookLabel = term === '1' ? '上册' : '下册';
  }

  return `${verLabel} · ${gradeLabel}${bookLabel}`;
}

Page({
  data: {
    recentList: [],
    statusBarHeight: 0,
    navTitleAreaHeight: 88,
    navTotalHeight: 0,
    lastTextbookText: ''  // 上次教材听写的显示文案
  },

  onLoad() {
    const winInfo = wx.getWindowInfo();
    const statusBarHeight = winInfo.statusBarHeight || 24;
    const rpx2px = winInfo.screenWidth / 750;
    const titleAreaPx = this.data.navTitleAreaHeight * rpx2px;
    const navTotalHeight = statusBarHeight + titleAreaPx;
    this.setData({
      statusBarHeight,
      navTotalHeight
    });
  },

  onShow() {
    this.loadRecentRecord();
    this.loadLastTextbook();
  },

  loadRecentRecord() {
    const rawRecords = lStore.getDictRecords();
    if (!rawRecords) {
      this.setData({ recentList: [] });
      return;
    }
    const list = Object.values(rawRecords).sort((a, b) => b.timestamp - a.timestamp);
    const top5 = list.slice(0, 3);

    const recentData = top5.map(item => {
      return {
        rId: item.rId,
        timeDisplay: this.formatTimeRelative(item.timestamp),
        wordCount: item.wordList ? item.wordList.length : 0,
        errCount: item.errCount ?? 0
      };
    });

    this.setData({ recentList: recentData });
  },

  // 读取英语版教材记忆（三字段），拼显示文案
  loadLastTextbook() {
    const saved = lStore.getEnSelected();
    const text = buildLastTextbookText(saved);
    this.setData({ lastTextbookText: text });
  },

  formatTimeRelative(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;

    if (diff < minute) {
      return '刚刚';
    } else if (diff < hour) {
      return Math.floor(diff / minute) + '分钟前';
    } else if (diff < day) {
      return Math.floor(diff / hour) + '小时前';
    } else if (diff < week) {
      const days = Math.floor(diff / day);
      return days === 1 ? '昨天' : days + '天前';
    } else if (diff < month) {
      return Math.floor(diff / week) + '周前';
    } else if (diff < year) {
      return Math.floor(diff / month) + '月前';
    } else {
      return Math.floor(diff / year) + '年前';
    }
  },

  viewPractice(e) {
    const rId = e.currentTarget.dataset.rid;
    const recordDict = lStore.getDictRecordById(rId);
    if (!recordDict) {
      wx.showToast({ title: '数据出错' });
      return;
    }
    const timeDisplay = this.formatTimeRelative(recordDict.timestamp);
    getApp().globalData.dictConfig = {
      wordList: recordDict.wordList,
      errCount: recordDict.errCount,
      timeDisplay: timeDisplay,
    };
    wx.navigateTo({
      url: `/pages/result/result`,
    });
  },

  goPhotoDict() {
    wx.navigateTo({ url: "/pages/camera/camera" });
  },
  goCustomDict() {
    wx.navigateTo({ url: "/pages/dictation/dictation?showAdd=true" });
  },
  goWrongBook() {
    wx.navigateTo({ url: "/pages/wordBook/wordBook" });
  },
  goRecord() {
    wx.navigateTo({ url: "/pages/record/record" });
  },
  goBooks() {
    wx.navigateTo({ url: "/pages/textbook/textbook" });
  },

  // "再听一遍"：跳教材页并让教材页恢复上次勾选（restore=1）
  continueLastTextbook() {
    if (!this.data.lastTextbookText) return;
    wx.navigateTo({
      url: '/pages/textbook/textbook?restore=1'
    });
  },

  onShareAppMessage(res) {
    return {
      title: getApp().globalData.appName,
      path: "/pages/index/index"
    };
  },
  onShareTimeline() {
    return {
      title: getApp().globalData.appName,
      query: ""
    };
  },

  // ========== 从相册选图 → 前处理裁剪为1.35比例 → 持久化 → 跳转裁剪页 ==========
  goUploadPhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.preprocessImage(tempFilePath);
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择失败', icon: 'none' });
        }
      }
    });
  },

  preprocessImage(filePath) {
    wx.getImageInfo({
      src: filePath,
      success: (info) => {
        const imgWidth = info.width;
        const imgHeight = info.height;
        const targetRatio = 1.35;

        let cropW, cropH, cropX, cropY;

        if (imgHeight / imgWidth >= targetRatio) {
          cropW = imgWidth;
          cropH = Math.floor(imgWidth * targetRatio);
          cropX = 0;
          cropY = Math.floor((imgHeight - cropH) / 2);
        } else {
          cropH = imgHeight;
          cropW = Math.floor(imgHeight / targetRatio);
          cropX = Math.floor((imgWidth - cropW) / 2);
          cropY = 0;
        }

        const query = this.createSelectorQuery();
        query.select('#preprocessCanvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            const canvas = res[0].node;
            const ctx = canvas.getContext('2d');

            canvas.width = cropW;
            canvas.height = cropH;

            const img = canvas.createImage();
            img.onload = () => {
              ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

              wx.canvasToTempFilePath({
                canvas: canvas,
                fileType: 'jpg',
                quality: 0.92,
                success: (tmpRes) => {
                  this.saveAndGoCrop(tmpRes.tempFilePath);
                },
                fail: () => {
                  this.saveAndGoCrop(filePath);
                }
              });
            };
            img.onerror = () => {
              this.saveAndGoCrop(filePath);
            };
            img.src = filePath;
          });
      },
      fail: () => {
        this.saveAndGoCrop(filePath);
      }
    });
  },

  saveAndGoCrop(filePath) {
    wx.saveFile({
      tempFilePath: filePath,
      success: (saveRes) => {
        getApp().globalData.tempImagePath = saveRes.savedFilePath;
        wx.navigateTo({
          url: '/pages/crop/crop?from=upload',
        });
      },
      fail: () => {
        wx.showToast({ title: '保存图片失败', icon: 'none' });
      }
    });
  },
})