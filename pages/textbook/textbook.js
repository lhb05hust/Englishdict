const lStore = require("../../utils/localStore");
const bookApi = require("../../utils/bookApi");

// 支持的教材版本（value 必须与后端 enbooks/ 下的目录名一致）
const VERSIONS = [
  { label: '人教版(PEP)', value: 'rjb_pep' },
  { label: '外研版',       value: 'wyb' },
  { label: '译林版',       value: 'ylb' },
  { label: '北师大版',     value: 'bsdb' },
  { label: '沪教版',       value: 'hjb' },
  { label: '教科版',       value: 'jkb' },
];

// 默认版本
const DEFAULT_VER = 'rjb_pep';

/**
 * 从 bid 解析年级和册次
 */
function parseBid(bid) {
  if (!bid || bid[0] !== 'b' || bid.length < 3) return { grade: 0, term: 0 };
  const grade = parseInt(bid.slice(1, -1), 10) || 0;
  const term = parseInt(bid.slice(-1), 10) || 0;
  return { grade, term };
}

Page({
  data: {
    showBookModal: false,

    versions: VERSIONS,
    selectedVer: DEFAULT_VER,

    grades: [
      { label: '三年级', value: 3 },
      { label: '四年级', value: 4 },
      { label: '五年级', value: 5 },
      { label: '六年级', value: 6 },
      { label: '七年级', value: 7 },
      { label: '八年级', value: 8 },
      { label: '九年级', value: 9 },
      { label: '高一',   value: 10 },
      { label: '高二',   value: 11 },
      { label: '高三',   value: 12 },
    ],
    selectedGrade: 0,
    selectedTerm: 0,

    bookLabel: '',
    units: [],
    selectedCount: 0,
  },

  _requestTask: null,
  _loadingFromMemory: false,
  _destroyed: false,

  onLoad() {
    const app = getApp();

    let ver = app.globalData.enSelectedVer || '';
    let bid = app.globalData.enSelectedBid || '';
    let fromMemory = false;

    if (!ver || !bid) {
      const savedVer = lStore.getEnSelectedVer ? lStore.getEnSelectedVer() : '';
      const savedBid = lStore.getEnSelectedBid ? lStore.getEnSelectedBid() : '';
      if (savedVer && savedBid) {
        ver = savedVer;
        bid = savedBid;
        fromMemory = true;

        app.globalData.enSelectedVer = ver;
        app.globalData.enSelectedBid = bid;
        const parsed = parseBid(bid);
        app.globalData.enSelectedGrade = parsed.grade;
        app.globalData.enSelectedTerm = parsed.term;
      }
    }

    if (ver && bid) {
      this._loadingFromMemory = fromMemory;
      const parsed = parseBid(bid);
      this.setData({
        selectedVer: ver,
        selectedGrade: parsed.grade,
        selectedTerm: parsed.term,
      });
      this.getBookUnits(ver, bid);
    }
  },

  onReady() {
    const app = getApp();
    if (!app.globalData.enSelectedVer || !app.globalData.enSelectedBid) {
      this.openBookModal();
    }
  },

  onUnload() {
    this._destroyed = true;
    if (this._requestTask) {
      this._requestTask.abort();
      this._requestTask = null;
    }
    wx.hideLoading();
  },

  openBookModal() {
    const app = getApp();
    this.setData({
      showBookModal: true,
      selectedVer: this.data.selectedVer || app.globalData.enSelectedVer || DEFAULT_VER,
      selectedGrade: this.data.selectedGrade || app.globalData.enSelectedGrade || 0,
      selectedTerm: this.data.selectedTerm || app.globalData.enSelectedTerm || 0,
    });
  },

  onCloseBookModal() {
    this.setData({ showBookModal: false });
  },

  onVerSelect(e) {
    this.setData({ selectedVer: e.currentTarget.dataset.value });
  },

  onGradeSelect(e) {
    this.setData({ selectedGrade: Number(e.currentTarget.dataset.value) });
  },

  onTermSelect(e) {
    this.setData({ selectedTerm: Number(e.currentTarget.dataset.value) });
  },

  onBookConfirm() {
    const { selectedVer, selectedGrade, selectedTerm } = this.data;

    if (!selectedGrade) {
      wx.showToast({ title: '请选择年级', icon: 'none' });
      return;
    }
    if (!selectedTerm) {
      wx.showToast({ title: '请选择册次', icon: 'none' });
      return;
    }
    if (!selectedVer) {
      wx.showToast({ title: '请选择版本', icon: 'none' });
      return;
    }

    const bid = `b${selectedGrade}${selectedTerm}`;
    const app = getApp();
    app.globalData.enSelectedVer = selectedVer;
    app.globalData.enSelectedGrade = selectedGrade;
    app.globalData.enSelectedTerm = selectedTerm;
    app.globalData.enSelectedBid = bid;

    if (lStore.saveEnSelectedVer) lStore.saveEnSelectedVer(selectedVer);
    if (lStore.saveEnSelectedBid) lStore.saveEnSelectedBid(bid);

    this.setData({ showBookModal: false });
    this._loadingFromMemory = false;

    this.getBookUnits(selectedVer, bid);
  },

  getBookUnits(ver, bid) {
    wx.showLoading({ title: '加载中', mask: false });

    const { promise, task } = bookApi.getBook(ver, bid);
    this._requestTask = task;

    promise.then((book) => {
      if (this._destroyed) return;
      this._requestTask = null;
      wx.hideLoading();

      if (!book || !Array.isArray(book.units)) {
        this.handleLoadFail('数据格式异常');
        return;
      }

      const units = book.units.map((u) => ({
        title: u.title || '',
        words: Array.isArray(u.words) ? u.words : [],
        _selected: false,
      }));

      const termText = book.term === 1 ? '上册' : '下册';
      const verValue = book.version || ver;
      const verLabel = (VERSIONS.find(v => v.value === verValue) || {}).label || verValue;

      this.setData({
        units,
        bookLabel: `${verLabel} · ${book.grade}年级${termText}`,
        selectedCount: 0,
        selectedGrade: book.grade,
        selectedTerm: book.term,
        selectedVer: verValue,
      });

      this._loadingFromMemory = false;
    }).catch((err) => {
      if (this._destroyed) return;
      this._requestTask = null;
      wx.hideLoading();

      if (err && err.errMsg && err.errMsg.indexOf('abort') !== -1) {
        console.log('用户取消加载');
        return;
      }

      console.error('请求失败', err);
      this.handleLoadFail('网络请求失败');
    });
  },

  handleLoadFail(msg) {
    if (this.data.units.length > 0) {
      wx.showToast({ title: '加载失败，保留原册', icon: 'none' });
      return;
    }

    if (this._loadingFromMemory) {
      if (lStore.clearEnSelectedBid) lStore.clearEnSelectedBid();
      if (lStore.clearEnSelectedVer) lStore.clearEnSelectedVer();

      const app = getApp();
      app.globalData.enSelectedVer = '';
      app.globalData.enSelectedBid = '';
      app.globalData.enSelectedGrade = 0;
      app.globalData.enSelectedTerm = 0;

      this._loadingFromMemory = false;
      wx.showToast({ title: '加载失败，请重新选择', icon: 'none' });
      setTimeout(() => this.openBookModal(), 800);
      return;
    }

    wx.showModal({
      title: '加载失败',
      content: msg + '，请检查网络后重试',
      showCancel: false,
      confirmText: '返回',
      success: () => {
        wx.navigateBack({
          fail: () => { wx.reLaunch({ url: '/pages/index/index' }); },
        });
      },
    });
  },

  // ============ 切换某个 Unit 的选中（一次 setData）============
  onToggleUnit(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx)) return;

    const units = this.data.units;
    if (!units[idx]) return;

    const newVal = !units[idx]._selected;

    const newUnits = units.slice();
    newUnits[idx] = { ...newUnits[idx], _selected: newVal };

    this.setData({
      units: newUnits,
      selectedCount: this.computeSelectedCountFrom(newUnits),
    });
  },

  // ============ 计算去重后的总词数（接收 units 参数）============
  computeSelectedCountFrom(units) {
    const seen = new Set();

    (units || []).forEach((u) => {
      if (!u._selected) return;
      (u.words || []).forEach((w) => {
        const text = (w.en || '').trim();
        if (text && !seen.has(text.toLowerCase())) {
          seen.add(text.toLowerCase());
        }
      });
    });

    return seen.size;
  },

  // 兼容旧调用
  computeSelectedCount() {
    return this.computeSelectedCountFrom(this.data.units);
  },

  onClearSelection() {
    if (this.data.selectedCount === 0) return;

    wx.showModal({
      title: '清空选择',
      content: '确定要清空所有已选内容吗？',
      confirmText: '清空',
      confirmColor: '#e53e3e',
      success: (res) => {
        if (!res.confirm) return;

        const units = this.data.units.map((u) => ({
          ...u,
          _selected: false,
        }));

        this.setData({ units, selectedCount: 0 });
      },
    });
  },

  onStartDictation() {
    const { selectedCount, units } = this.data;

    if (selectedCount === 0) {
      wx.showToast({ title: '请先选择单元', icon: 'none' });
      return;
    }

    const seen = new Set();
    const wordList = [];
    let idx = 0;

    units.forEach((u) => {
      if (!u._selected) return;
      (u.words || []).forEach((w) => {
        const text = (w.en || '').trim();
        const cn = (w.cn || '').trim();
        if (!text) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        wordList.push({
          wordId: Date.now() + (idx++),
          text,
          cn,
        });
      });
    });

    getApp().globalData.dictConfig = {
      wordList,
      readOrder: 'sequential',
      readTimes: 2,
      gap: 5,
      takeCount: wordList.length,
    };

    wx.navigateTo({ url: '/pages/play/play' });
  },

  noop() {},
});