const lStore = require("../../utils/localStore");
const bookApi = require("../../utils/bookApi");

// ============ 静态配置 ============
// 年级列表（硬编码，不走接口）
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

// 版本中文名映射：仅用于拼装顶部标题和摘要文案
// 展示顺序和可用性完全由 /en/meta 决定
const VER_LABELS = {
  rjb:  '人教版',
  wyb:  '外研版',
  ylb:  '译林版',
  bsdb: '北师大版',
  hjb:  '沪教版',
  jkb:  '教科版',
};

function getVerLabel(ver) {
  return VER_LABELS[ver] || ver;
}

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
  const gradeLabel = grade ? grade.label : '';
  const verLabel = getVerLabel(ver);

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

  const parts = [];
  if (ver) parts.push(getVerLabel(ver));
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

    // 从 /en/meta 拉取的数据
    versions: [],           // [{label, ver}]，用于渲染版本区
    availability: {},       // { gradeKey: [ver, ...] }
    visibleVersions: [],    // 当前年级下可见的版本

    // 年级列表（硬编码）
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
  _metaTask: null,
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
    if (this._metaTask) {
      this._metaTask.abort();
      this._metaTask = null;
    }
    wx.hideLoading();
  },

  // ============ 弹窗 ============
  // 每次打开都拉 meta（不做缓存）
  openBookModal() {
    wx.showLoading({ title: '加载中', mask: false });

    const { promise, task } = bookApi.getEnMeta();
    this._metaTask = task;

    promise.then((meta) => {
      if (this._destroyed) return;
      this._metaTask = null;
      wx.hideLoading();

      const versions = Array.isArray(meta.versions) ? meta.versions : [];
      const availability = meta.availability || {};

      // 按当前年级过滤可见版本
      const selectedGrade = this.data.selectedGrade;
      const allowed = availability[selectedGrade] || [];
      const visibleVersions = versions.filter(v => allowed.includes(v.ver));

      // 校验之前选中的版本在新数据下是否仍可用
      const selectedVer = this.data.selectedVer;
      const verStillValid = selectedVer && allowed.includes(selectedVer);

      this.setData({
        versions,
        availability,
        visibleVersions,
        selectedVer: verStillValid ? selectedVer : '',
        selectedBid: verStillValid ? this.data.selectedBid : '',
        showBookModal: true,
      });
    }).catch((err) => {
      if (this._destroyed) return;
      this._metaTask = null;
      wx.hideLoading();

      if (err && err.errMsg && err.errMsg.indexOf('abort') !== -1) {
        console.log('用户取消加载');
        return;
      }

      console.error('meta 请求失败', err);
      this.handleLoadFail('网络请求失败');
    });
  },

  onCloseBookModal() {
    this.setData({ showBookModal: false });
  },

  // 选年级 → 重建册次列表、重新计算可见版本、清理后续选择
  onGradeSelect(e) {
    const key = e.currentTarget.dataset.key;
    const { selectedVer, availability, versions } = this.data;

    const allowed = availability[key] || [];
    const visibleVersions = versions.filter(v => allowed.includes(v.ver));

    // 校验之前选中的版本在新年级下是否仍可用
    const verStillValid = selectedVer && allowed.includes(selectedVer);
    const newVer = verStillValid ? selectedVer : '';

    this.setData({
      selectedGrade: key,
      selectedVer: newVer,
      selectedBid: '',
      visibleVersions,
      books: getBooksForGrade(key),
      selectedSummary: buildSummary(key, newVer, ''),
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

  // 统一失败处理：有教材 → 保留原册；无教材 → 退回首页
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