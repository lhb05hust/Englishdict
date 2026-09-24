// pages/record/record.js
const lStore = require("../../utils/localStore");

Page({
  data: {
    recordList: [], // 存储处理后的记录列表
    navBarHeight: 0, // 用于适配顶部导航栏高度
  },

  onLoad() {
    this.loadRecords();
    
    // 获取系统信息以计算顶部安全距离（可选，为了更好看）
    const systemInfo = wx.getSystemInfoSync();
    this.setData({
      navBarHeight: systemInfo.statusBarHeight + 44 
    });
  },

  onShow() {
    // 每次返回页面时刷新数据
    this.loadRecords();
  },

  loadRecords() {
    const rawRecords = lStore.getDictRecords();
    if (!rawRecords) return;

    // 将 Map 或 Object 转换为数组，并按时间倒序排列（最新的在前面）
    const list = Object.values(rawRecords).sort((a, b) => b.timestamp - a.timestamp);

    // 处理时间显示格式
    const formattedList = list.map(item => ({
      ...item,
      timeDisplay: this.formatTimeRelative(item.timestamp),
      wordCount: item.wordList ? item.wordList.length : 0
    }));

    this.setData({
      recordList: formattedList
    });
  },

  /**
   * 核心功能：时间戳转相对时间描述
   * 规则：刚刚, 1小时前, 1天前, 1周前, 1月前, 1年前...
   */
  formatTimeRelative(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day; // 近似值
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

  // 点击某条记录，跳转到详情页进行复习
  onRecordTap(e) {
    const rId = e.currentTarget.dataset.rid;
    let recordDict = lStore.getDictRecordById(rId);
    if (!recordDict) {
      console.log("无该id=${rId}的听写记录");
      wx.showToast({
        title: '数据出错',
      });
      return;   // ← 修复：防止 recordDict 为空时下一行报错
    }
    let timeDisplay = this.formatTimeRelative(recordDict.timestamp);
    getApp().globalData.dictConfig = {
      wordList: recordDict.wordList,
      errCount: recordDict.errCount,
      timeDisplay: timeDisplay,
    };
    wx.navigateTo({
      url: `/pages/result/result`,
    });
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

  // 左滑删除单条记录
  onDeleteRecord(e) {
    const rId = e.currentTarget.dataset.rid;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条听写记录吗？',
      confirmText: '删除',
      confirmColor: '#e53e3e',
      success: (res) => {
        if (!res.confirm) return;
        const ok = lStore.removeDictRecord(rId);
        if (ok) {
          this.loadRecords();
          wx.showToast({ title: '已删除', icon: 'success' });
        } else {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },
});