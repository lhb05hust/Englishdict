const lStore = require("../../utils/localStore");
const bookApi = require("../../utils/bookApi");

// ============ 静态配置 ============
// 版本列表：label 是用户看到的，ver 是后端文件夹名
// 未来某个版本没数据，注释掉对应行即可
const VERSIONS = [
  { label: '人教版',   ver: 'rjb'  },
  { label: '译林版',   ver: 'ylb'  },
  { label: '沪教版',   ver: 'hjb'  },
  { label: '外研版',   ver: 'wyb'  },
  { label: '教科版',   ver: 'jkb'  },
  { label: '北师大版', ver: 'bsdb' },
];

// 年级列表：小学 3-6 + 初中 7-9 + 高中
const GRADES = [
  { key: 'p3', label: '三年级', stage: 'primary', gradeNum: 3 },
  { key: 'p4', label: '四年级', stage: 'primary', gradeNum: 4 },
  { key: 'p5', label: '五年级', stage: 'primary', gradeNum: 5 },
  { key: 'p6', label: '六年级', stage: 'primary', gradeNum: 6 },
  { key: 'j7', label: '七年级', stage: 'junior',  gradeNum: 7 },
  { key: 'j8', label: '八年级', stage: 'junior',  gradeNum: 8 },
  { key: 'j9', label: '九年级', stage: 'junior',  gradeNum: 9 },
  { key: 'senior', label: '高中', stage: 'senior' },
];

// 高中固定 7 册
const SENIOR_BOOKS = [
  { bid: 'bx1', label: '必修1' },
  { bid: 'bx2', label: '必修2' },
  { bid: 'bx3', label: '必修3' },
  { bid: 'xb1', label: '选必1' },
  { bid: 'xb2', label: '选必2' },
  { bid: 'xb3', label: '选必3' },
  { bid: 'xb4', label: '选必4' },
];

/**
 * 根据年级生成册次列表
 * 小学/初中 → 上册、下册
 * 高中 → 必修1~3 + 选必1~4
 */
function getBooksForGrade(gradeKey) {
  const grade = GRADES.find(g => g.key === gradeKey);
  if (!grade) return [];
  if (grade.stage === 'senior') {
    return SENIOR_BOOKS;
  }
  return [
    { bid: `b${grade.gradeNum}1`, label: '上册' },
    { bid: `b${grade.gradeNum}2`, label: '下册' },
  ];
}

/**
 * 组装顶部显示文案：版本 · 年级 + 册次
 */
function buildBookLabel(gradeKey, ver, bid) {
  const grade = GRADES.find(g => g.key === gradeKey);
  const version = VERSIONS.find(v => v.ver === ver);
  const gradeLabel = grade ? grade.label : '';
  const verLabel = version ? version.label : ver;

  let bookLabel = '';
  if (grade && grade.stage === 'senior') {
    const sb = SENIOR_BOOKS.find(b => b.bid === bid);
    bookLabel = sb ? sb.label : '';
  } else {
    const term = bid.slice(-1);
    bookLabel = term === '1' ? '上册' : '下册';
  }
  return `${verLabel} · ${gradeLabel}${bookLabel}`;
}

/**
 * 弹窗标题尾部追加的提示
 * 选一层加一层，全选完显示完整三段
 * 未选任何一层 → 空字符串（尾部不显示）
 */
function buildSummary(gradeKey, ver, bid) {
  const grade = GRADES.find(g => g.key === gradeKey);
  const version = VERSIONS.find(v => v.ver === ver);

  const parts = [];
  if (version) parts.push(version.label);
  if (grade) parts.push(grade.label);
  if (bid && grade) {
    let bookLabel = '';
    if (grade.stage === 'senior') {
      const sb = SENIOR_BOOKS.find(b => b.bid === bid);
      bookLabel = sb ? sb.label : '';
    } else {
      bookLabel = bid.slice(-1) === '1' ? '上册' : '下册';
    }
    if (bookLabel) parts.push(bookLabel);
  }

  return parts.join(' · ');
}

Page({
  data: {
    showBookModal: false,

    // 静态配置
    versions: VERSIONS,
    grades: GRADES,
    books: [],

    // 用户选择
    selectedGrade: '',
    selectedVer: '',
    selectedBid: '',

    // 标题尾部提示
    selectedSummary: '',

    // 教材数据
    bookLabel: '',
    units: [],
    selectedCount: 0,
  },

  _requestTask: null,
  _loadingFromMemory: false,
  _destroyed: false,

  onLoad() {
    const saved = lStore.getEnSelected();
    if (saved.grade && saved.ver && saved.bid) {
      // 恢复上次选择
      this._loadingFromMemory = true;
      this.setData({
        selectedGrade: saved.grade,
        selectedVer: saved.ver,
        selectedBid: saved.bid,
        books: getBooksForGrade(saved.grade),
        selectedSummary: buildSummary(saved.grade, saved.ver, saved.bid),
      });
      this.getBookUnits(saved.ver, saved.bid);
    }
  },

  onReady() {
    // 没有记忆 → 打开选择弹窗
    if (!this.data.selectedBid) {
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

  // ============ 弹窗 ============
  openBookModal() {
    this.setData({ showBookModal: true });
  },

  onCloseBookModal() {
    this.setData({ showBookModal: false });
  },

  // 选年级 → 重建册次列表，清空后续选择
  onGradeSelect(e) {
    const key = e.currentTarget.dataset.key;
    const selectedVer = this.data.selectedVer;
    this.setData({
      selectedGrade: key,
      selectedBid: '',
      books: getBooksForGrade(key),
      selectedSummary: buildSummary(key, selectedVer, ''),
    });
  },

  // 选版本 → 清空册次
  onVerSelect(e) {
    const ver = e.currentTarget.dataset.ver;
    const selectedGrade = this.data.selectedGrade;
    this.setData({
      selectedVer: ver,
      selectedBid: '',
      selectedSummary: buildSummary(selectedGrade, ver, ''),
    });
  },

  // 选册次
  onBookSelect(e) {
    const bid = e.currentTarget.dataset.bid;
    const { selectedGrade, selectedVer } = this.data;
    this.setData({
      selectedBid: bid,
      selectedSummary: buildSummary(selectedGrade, selectedVer, bid),
    });
  },

  onBookConfirm() {
    const { selectedGrade, selectedVer, selectedBid } = this.data;

    if (!selectedGrade) { wx.showToast({ title: '请选择年级', icon: 'none' }); return; }
    if (!selectedVer)   { wx.showToast({ title: '请选择版本', icon: 'none' }); return; }
    if (!selectedBid)   { wx.showToast({ title: '请选择册次', icon: 'none' }); return; }

    // 持久化三字段
    lStore.saveEnSelected(selectedGrade, selectedVer, selectedBid);

    this.setData({ showBookModal: false });
    this._loadingFromMemory = false;

    this.getBookUnits(selectedVer, selectedBid);
  },

  // ============ 加载教材 ============
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

      const { selectedGrade, selectedVer, selectedBid } = this.data;
      const label = buildBookLabel(selectedGrade, selectedVer, selectedBid);

      this.setData({
        units,
        bookLabel: label,
        selectedCount: 0,
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
      lStore.clearEnSelected();
      this.setData({
        selectedGrade: '',
        selectedVer: '',
        selectedBid: '',
        books: [],
        selectedSummary: '',
      });
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

  // ============ 单元选中 ============
  onToggleUnit(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx)) return;

    const units = this.data.units;
    if (!units[idx]) return;

    const newUnits = units.slice();
    newUnits[idx] = { ...newUnits[idx], _selected: !units[idx]._selected };

    this.setData({
      units: newUnits,
      selectedCount: this.computeSelectedCountFrom(newUnits),
    });
  },

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

  onClearSelection() {
    if (this.data.selectedCount === 0) return;

    wx.showModal({
      title: '清空选择',
      content: '确定要清空所有已选内容吗？',
      confirmText: '清空',
      confirmColor: '#e53e3e',
      success: (res) => {
        if (!res.confirm) return;
        const units = this.data.units.map((u) => ({ ...u, _selected: false }));
        this.setData({ units, selectedCount: 0 });
      },
    });
  },

  // ============ 开始听写 ============
  onStartDictation() {
    const { selectedCount, units } = this.data;

    if (selectedCount === 0) {
      wx.showToast({ title: '请先选择单元', icon: 'none' });
      return;
    }

    const seen = new Set();
    const wordList = [];

    units.forEach((u) => {
      if (!u._selected) return;
      (u.words || []).forEach((w) => {
        const text = (w.en || '').trim();
        const cn = (w.cn || '').trim();
        if (!text) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        wordList.push({ en: text, cn });
      });
    });

    if (wordList.length === 0) {
      wx.showToast({ title: '请先选择单元', icon: 'none' });
      return;
    }

    getApp().globalData.tempWordList = wordList;
    wx.navigateTo({ url: '/pages/dictation/dictation' });
  },

  noop() {},
});