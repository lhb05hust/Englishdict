const lStore = require("../../utils/localStore");
Page({
  data:{
    recentList:[],
    statusBarHeight:0,   //状态栏高度，单位px
    navTitleAreaHeight:88, //标题区固定高度 rpx，转px
    navTotalHeight:0
  },
  onLoad() {
    // 获取系统窗口信息，statusBarHeight单位px
    const winInfo = wx.getWindowInfo();
    const statusBarHeight = winInfo.statusBarHeight || 24; //兜底，防止部分安卓返回0
    console.log(statusBarHeight);
    // rpx转px公式：屏幕宽度 /750
    const rpx2px = winInfo.screenWidth /750;
    const titleAreaPx = this.data.navTitleAreaHeight * rpx2px;

    const navTotalHeight = statusBarHeight + titleAreaPx;
    this.setData({
      statusBarHeight,
      navTotalHeight
    });
  },
  
  onShow(){
    // 页面打开加载最近练习记录
    this.loadRecentRecord()
  },
  loadRecentRecord() {
    const rawRecords = lStore.getDictRecords();
    if (!rawRecords) {
      this.setData({ recentList: [] });
      return;
    }
    // Object.values转数组，时间戳倒序，最新在前
    const list = Object.values(rawRecords).sort((a, b) => b.timestamp - a.timestamp);
    // 只取前5条
    const top5 = list.slice(0, 3);

    // 字段完全对齐 dict_records 的formattedList
    const recentData = top5.map(item => {
      return {
        rId: item.rId,
        timeDisplay: this.formatTimeRelative(item.timestamp),
        wordCount: item.wordList ? item.wordList.length : 0,
        errCount: item.errCount ?? 0
      };
    });

    this.setData({
      recentList: recentData
    });
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
    console.log(rId);
    console.log(this.data.recentList);
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

  goPhotoDict(){
    wx.navigateTo({ url: "/pages/camera/camera" });
  },
  goCustomDict(){
    wx.navigateTo({url:"/pages/dictation/dictation?showAdd=true"})
  },
  goWrongBook(){
    wx.navigateTo({url:"/pages/wordBook/wordBook"})
  },
  goRecord(){
    wx.navigateTo({ url: "/pages/record/record" });
  },
  goBooks() {
    wx.navigateTo({ url: "/pages/textbook/textbook" });
  },
  continuePractice(e){
    const id = e.currentTarget.dataset.id
    // todo:继续上次听写
  },
  onShareAppMessage(res) {
    return {
      title: getApp().globalData.appName,
      path: "/pages/index/index"
    }
  },
  onShareTimeline(){
    return {
      title:getApp().globalData.appName,
      query:""
    }
  },

  // ========== 以下为新增方法 ==========

  // 从相册选图 → 前处理裁剪为1.35比例 → 持久化 → 跳转裁剪页
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

  // 图片前处理：居中裁剪使宽高比 = 1.35，与相机预览比例一致
  preprocessImage(filePath) {
    wx.getImageInfo({
      src: filePath,
      success: (info) => {
        const imgWidth = info.width;
        const imgHeight = info.height;
        const targetRatio = 1.35;

        let cropW, cropH, cropX, cropY;

        if (imgHeight / imgWidth >= targetRatio) {
          // 图片偏高 → 裁上下
          cropW = imgWidth;
          cropH = Math.floor(imgWidth * targetRatio);
          cropX = 0;
          cropY = Math.floor((imgHeight - cropH) / 2);
        } else {
          // 图片偏宽 → 裁左右
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
                  // canvas处理失败降级用原图
                  this.saveAndGoCrop(filePath);
                }
              });
            };
            img.onerror = () => {
              // 图片加载失败降级用原图
              this.saveAndGoCrop(filePath);
            };
            img.src = filePath;
          });
      },
      fail: () => {
        // 获取图片信息失败降级用原图
        this.saveAndGoCrop(filePath);
      }
    });
  },

  // 持久化 + 跳转裁剪页（与 camera.js takePhoto 后半段逻辑一致）
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