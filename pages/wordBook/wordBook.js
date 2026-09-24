// pages/wordBook/wordBook.js
const wordUtils = require('../../utils/localStore');

Page({
  data: {
    sortType: 'errorCount',       // 'errorCount' | 'newest'
    currentTab: 'review',         // 'review' | 'mastered' | 'wait'
    displayList: [],
    reviewCount: 0,
    masteredCount: 0,
    batchMode: false,
    selectedIds: [],              // 选中的错题条目ID
    allSelected: false,
    waitlist: [],
  },

  refreshDataList(waitlist) {
    if (!waitlist || waitlist.length === 0) return;
    let list = this.data.displayList;
    const nList = list.map(item => ({
      ...item,
      disabled: waitlist.some(itemx => itemx.wordId === item.wordId),
    }));
    this.setData({ displayList: nList });
  },

  onReady() {
    this.loadData();
  },

  loadData() {
    if (this.data.currentTab == 'wait') {
      this.setData({
        displayList: this.data.waitlist,
      });
      return;
    }
    // 获取所有错题（按排序）
    const all = wordUtils.getWrongWords(this.data.sortType);
    // 分离待复习和已掌握
    const review = all.filter(item => !item.mastered);
    const mastered = all.filter(item => item.mastered);
    if (this.data.currentTab === 'review') {
      this.setData({
        reviewCount: review.length,
        masteredCount: mastered.length,
        displayList: review,
      }, () => {
        this.refreshDataList(this.data.waitlist);
      });
    } else {
      this.setData({
        reviewCount: review.length,
        masteredCount: mastered.length,
        displayList: mastered,
      });
    }
  },

  // 切换排序
  changeSort(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ sortType: type }, () => {
      this.loadData();
    });
  },

  // 切换Tab
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab, selectedIds: [], allSelected: false }, () => {
      this.loadData();
    });
  },

  // 批量模式切换
  toggleBatchMode() {
    this.setData({
      batchMode: !this.data.batchMode,
      selectedIds: [],
      allSelected: false
    });
  },

  // 单选/取消单选
  toggleSelect(e) {
    const id = e.currentTarget.dataset.id;
    let selected = this.data.selectedIds;
    const index = selected.indexOf(id);
    if (index > -1) {
      selected.splice(index, 1);
    } else {
      selected.push(id);
    }
    const allSelected = selected.length === this.data.displayList.length;
    this.setData({ selectedIds: selected, allSelected });
  },

  // 全选/取消全选
  toggleAll() {
    const allSelected = !this.data.allSelected;
    const selectedIds = allSelected ? this.data.displayList.map(item => item.wordId) : [];
    this.setData({ allSelected, selectedIds });
  },

  // 标记已掌握（单条）
  markMastered(e) {
    const id = e.currentTarget.dataset.id;
    const success = wordUtils.markMastered(id);
    let text = wordUtils.getTextById(id);
    if (success) {
      wx.showToast({ title: `'${text}'已掌握`, icon: 'none' });
      this.loadData();
    } else {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 取消掌握（单条）
  unmarkMastered(e) {
    const id = e.currentTarget.dataset.id;
    const success = wordUtils.unmarkMastered(id);
    let text = wordUtils.getTextById(id);
    if (success) {
      wx.showToast({ title: `'${text}'已移回复习`, icon: 'none' });
      this.loadData();
    } else {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  //取消待听
  unmarkWait(e) {
    const id = e.currentTarget.dataset.id;
    let waitl = this.data.waitlist;
    let ftered = waitl.filter(item => item.wordId !== id);
    this.setData({ waitlist: ftered }, () => {
      this.loadData();
    });
  },

  // 删除单条错题
  deleteWrong(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定从错题本中移除该单词吗？',
      success: (res) => {
        if (res.confirm) {
          const result = wordUtils.removeWrongWord(id);
          if (result.success) {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadData();
          } else {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 单独听写（一个词）
  startSingleDict(e) {
    const id = e.currentTarget.dataset.id;
    let wl = this.data.waitlist;
    let existing = wl.some(item => item.wordId === id);
    if (existing) {
      wx.showToast({ title: '不能重复添加', icon: 'success' });
      return;
    }
    let allWr = this.data.displayList;
    const item = allWr.find(item => item.wordId === id);
    if (!item) return;
    const newWl = [...wl, item];
    this.setData({ waitlist: newWl }, () => {
      this.refreshDataList(newWl);
    });

    wx.showToast({ title: '已加入待听列表', icon: 'success' });
  },

  // ---- 批量操作 ----
  // 获取选中词语的对象数组 [{en, cn}]
  getSelectedItems() {
    const selectedIds = this.data.selectedIds;
    const all = wordUtils.getWrongWords(this.data.sortType);
    const selectedItems = all.filter(item => selectedIds.includes(item.wordId));
    return selectedItems.map(item => ({ en: item.text, cn: item.cn || '' }));
  },

  batchDict() {
    const items = this.getSelectedItems();
    if (items.length === 0) {
      wx.showToast({ title: '请至少选择一个', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/dictation/dictation?words=${encodeURIComponent(JSON.stringify(words))}`
    });
    this.setData({ batchMode: false, selectedIds: [], allSelected: false });
  },

  batchMaster() {
    const ids = this.data.selectedIds;
    if (ids.length === 0) {
      wx.showToast({ title: '请至少选择一个', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '批量标记已掌握',
      content: `确定将选中的 ${ids.length} 个单词标记为已掌握吗？`,
      success: (res) => {
        if (res.confirm) {
          let successCount = 0;
          ids.forEach(id => {
            if (wordUtils.markMastered(id)) successCount++;
          });
          wx.showToast({ title: `成功标记 ${successCount} 个`, icon: 'success' });
          this.setData({ batchMode: false, selectedIds: [], allSelected: false });
          this.loadData();
        }
      }
    });
  },

  batchDelete() {
    const ids = this.data.selectedIds;
    if (ids.length === 0) {
      wx.showToast({ title: '请至少选择一个', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '批量删除',
      content: `确定从错题本中删除选中的 ${ids.length} 个单词吗？`,
      success: (res) => {
        if (res.confirm) {
          let successCount = 0;
          ids.forEach(id => {
            const result = wordUtils.removeWrongWord(id);
            if (result.success) successCount++;
          });
          wx.showToast({ title: `成功删除 ${successCount} 个`, icon: 'success' });
          this.setData({ batchMode: false, selectedIds: [], allSelected: false });
          this.loadData();
        }
      }
    });
  },

  //确认并开始启动专项听写
  onConfirm() {
    if (this.data.waitlist.length === 0) {
      wx.showToast({ title: '请选词加入待听列表', icon: 'none', duration: 2000 });
      return;
    }

    const items = this.data.waitlist.map(item => ({ en: item.text, cn: item.cn || '' }));
    wx.navigateTo({
      url: `/pages/dictation/dictation?words=${JSON.stringify(items)}`
    });
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
});