const lStore = require("../../utils/localStore");

/** 英文词条归一化：trim / 转小写 / 连续空格压成一个 */
function normText(s) {
  return String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s{2,}/g, ' ');
}

/** 中文释义只做纯格式处理：去换行、trim、压空格 */
function normCn(s) {
  return String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/\s{2,}/g, ' ');
}

/** 从 OCR 返回数据中提取 wordList，兼容多种形态 */
function extractWordList(ocrData) {
  if (!ocrData) return [];
  if (Array.isArray(ocrData)) return ocrData;
  if (Array.isArray(ocrData.wordList)) return ocrData.wordList;
  if (ocrData.data && Array.isArray(ocrData.data.wordList)) return ocrData.data.wordList;
  return [];
}

Page({
  data: {
    wordList: [],
    isDragging: false,
    draggingId: null,
    ghostX: 0,
    ghostY: 0,
    ghostW: 0,
    ghostH: 0,
    ghostItem: null,
    ghostIndex: 0,

    order: 'sequential',   // 报读顺序：'sequential' | 'random'
    times: 2,              // 报读次数：1 | 2 | 3
    interval: 5,           // 间隔时间：3 | 5 | 8 | 'custom'
    customSeconds: 10,

    takeCount: 0,          // 听写数量
    totalWords: 0,         // 总词数

    showAddModal: false,
    addInput: '',
    parsedWords: [],
    skippedCount: 0,
    keyboardHeight: 0,

    showAdd: false
  },
  itemRects: [],
  dragOffsetX: 0,
  dragOffsetY: 0,

  onLoad(options) {
    this.setData({ showAdd: options.showAdd || false });

    let ocrData = null;
    try {
      ocrData = JSON.parse(options.words || 'null');
    } catch (e) {
      ocrData = null;
    }

    const rawList = extractWordList(ocrData);
    const baseTime = Date.now();
    const initList = rawList
      .map((item, idx) => {
        const text = normText(item.en || item.text || '');
        return {
          wordId: 'tmp_' + baseTime + '_' + idx,
          text,
          cn: normCn(item.cn || ''),
        };
      })
      .filter((item) => item.text);

    this.setData({
      wordList: initList,
      takeCount: initList.length,
      totalWords: initList.length,
    });
  },

  onReady() {
    this.updateItemRects();
    if (this.data.showAdd) {
      this.onAddNew();
    }
  },

  updateItemRects(cb) {
    const query = wx.createSelectorQuery().in(this);
    query.selectAll('.grid-item').boundingClientRect();
    query.exec((res) => {
      if (res[0] && res[0].length > 0) {
        this.itemRects = res[0];
      }
      if (typeof cb === 'function') cb();
    });
  },

  // ========== 拖拽开始 ==========
  onDragStart(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.wordList[index];
    const touch = e.touches[0];

    const startDrag = () => {
      const rect = this.itemRects[index];
      if (!rect) return;

      this.dragOffsetX = touch.clientX - rect.left;
      this.dragOffsetY = touch.clientY - rect.top;

      this.setData({
        isDragging: true,
        draggingId: item.wordId,
        ghostItem: { ...item },
        ghostIndex: index,
        ghostX: rect.left,
        ghostY: rect.top,
        ghostW: rect.width,
        ghostH: rect.height,
      });
    };

    if (this.itemRects.length > 0) {
      startDrag();
    } else {
      this.updateItemRects(startDrag);
    }
  },

  // ========== 拖拽中 ==========
  onDragMove(e) {
    if (!this.data.isDragging) return;

    const touch = e.touches[0];
    const newX = touch.clientX - this.dragOffsetX;
    const newY = touch.clientY - this.dragOffsetY;

    this.setData({ ghostX: newX, ghostY: newY });

    const centerX = newX + this.data.ghostW / 2;
    const centerY = newY + this.data.ghostH / 2;

    let targetIndex = -1;
    for (let i = 0; i < this.itemRects.length; i++) {
      const r = this.itemRects[i];
      if (
        centerX >= r.left &&
        centerX <= r.right &&
        centerY >= r.top &&
        centerY <= r.bottom
      ) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex !== -1) {
      const currentIndex = this.data.wordList.findIndex(
        (it) => it.wordId === this.data.draggingId
      );
      if (targetIndex !== currentIndex) {
        this.swapItems(currentIndex, targetIndex);
      }
    }
  },

  // ========== 交换数据 ==========
  swapItems(fromIndex, toIndex) {
    const wordList = [...this.data.wordList];
    const temp = wordList[fromIndex];
    wordList[fromIndex] = wordList[toIndex];
    wordList[toIndex] = temp;

    this.setData({ wordList });

    wx.nextTick(() => {
      this.updateItemRects();
    });
  },

  // ========== 拖拽结束 ==========
  onDragEnd() {
    this.setData({
      isDragging: false,
      draggingId: null,
      ghostItem: null,
    });
  },

  // 1. 删除词语
  onDelete(e) {
    const index = e.currentTarget.dataset.index;
    const list = this.data.wordList;
    list.splice(index, 1);
    const newTotal = list.length;
    let newTakeCount = this.data.takeCount;
    if (newTakeCount > newTotal || newTakeCount == this.data.totalWords) {
      newTakeCount = newTotal;
    }
    this.setData({
      wordList: list,
      totalWords: newTotal,
      takeCount: newTakeCount,
    });

    wx.nextTick(() => {
      this.updateItemRects();
    });
  },

  // 2. 点击英文单词修改
  onEditWord(e) {
    const index = e.currentTarget.dataset.index;
    const oldWord = this.data.wordList[index].text;
    wx.showModal({
      title: '修改单词',
      editable: true,
      placeholderText: '英文单词或短语，最多 40 字符',
      content: oldWord,
      success: (res) => {
        if (res.confirm && res.content) {
          const txt = normText(res.content);
          if (!txt) return;
          if (txt.length > 40) {
            wx.showToast({ title: '不能超过 40 个字符', icon: 'none' });
            return;
          }
          const list = this.data.wordList;
          list[index].text = txt;
          this.setData({ wordList: list });
        }
      }
    });
  },

  // 3. 点击中文释义修改
  onEditCn(e) {
    const index = e.currentTarget.dataset.index;
    const oldCn = this.data.wordList[index].cn || '';
    wx.showModal({
      title: '修改释义',
      editable: true,
      placeholderText: '中文释义，可留空',
      content: oldCn,
      success: (res) => {
        if (res.confirm) {
          const list = this.data.wordList;
          list[index].cn = normCn(res.content || '');
          this.setData({ wordList: list });
        }
      }
    });
  },

  onOrderChange(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ order: value });
  },

  onTimesChange(e) {
    const value = parseInt(e.currentTarget.dataset.value, 10);
    this.setData({ times: value });
  },

  onIntervalChange(e) {
    const value = e.currentTarget.dataset.value;
    const realValue = value === 'custom' ? 'custom' : parseInt(value, 10);
    this.setData({ interval: realValue });

    if (realValue === 'custom') {
      this.onCustomTap();
    }
  },

  onCustomTap() {
    wx.showModal({
      title: '自定义间隔时间',
      placeholderText: '请输入秒数',
      editable: true,
      content: String(this.data.customSeconds),
      confirmText: '确定',
      success: (res) => {
        if (res.confirm && res.content) {
          const seconds = parseInt(res.content, 10);
          if (seconds > 0) {
            this.setData({ customSeconds: seconds });
          } else {
            wx.showToast({ title: '请输入有效的秒数', icon: 'none' });
          }
        }
      },
    });
  },

  onTakeCountChanging(e) {
    this.setData({ takeCount: e.detail.value });
  },

  onTakeCountChange(e) {
    this.setData({ takeCount: e.detail.value });
  },

  // 确认并开始
  onConfirm() {
    if (this.data.wordList.length === 0) {
      wx.showToast({ title: '请至少添加一个单词', icon: 'none' });
      return;
    }

    const takeCount = Math.min(this.data.takeCount, this.data.totalWords);
    const gap = this.data.interval === 'custom'
      ? this.data.customSeconds
      : this.data.interval;

    getApp().globalData.dictConfig = {
      wordList: this.data.wordList,
      readOrder: this.data.order,
      readTimes: this.data.times,
      gap: gap,
      takeCount: takeCount,
    };

    wx.navigateTo({ url: "/pages/play/play" });

    setTimeout(() => {
      lStore.addWordsBatch(
        this.data.wordList.map((item) => ({ text: item.text, cn: item.cn || '' }))
      );
    }, 30);
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

  // ========== 3. 新增词语（点击卡片，打开批量弹窗） ==========
  onAddNew() {
    this.setData({
      showAddModal: true,
      addInput: '',
      parsedWords: [],
      skippedCount: 0,
    });
  },

  onPasteFromClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const clipText = (res.data || '').trim();
        if (!clipText) {
          wx.showToast({
            title: '请先复制单词再来粘贴',
            icon: 'none',
            duration: 2000,
          });
          return;
        }

        const oldVal = this.data.addInput || '';
        const merged = oldVal ? (oldVal + '\n' + clipText) : clipText;
        const input = merged.slice(0, 150);

        const { valid, skipped } = this.parseInput(input);
        this.setData({
          addInput: input,
          parsedWords: valid,
          skippedCount: skipped,
        });
      },
      fail: () => {
        wx.showToast({
          title: '请先复制单词再来粘贴',
          icon: 'none',
          duration: 2000,
        });
      },
    });
  },

  /**
   * 解析输入文本，返回 { valid, skipped }
   * 英文规则：
   * - 用换行 / 逗号 / 分号 / 顿号切分（空格视为短语的一部分，不拆）
   * - 每段 trim、压空格、转小写
   * - 只保留：以字母开头，由字母 / 空格 / 连字符 / 撇号组成，长度 1-40
   */
  parseInput(text) {
    if (!text) return { valid: [], skipped: 0 };

    const parts = text
      .split(/[\n,，、;；]+/)
      .map((w) => normText(w))
      .filter((w) => w);

    if (parts.length === 0) return { valid: [], skipped: 0 };

    const valid = [];
    let skipped = 0;
    const re = /^[a-z][a-z\s'\-]*$/;

    for (const w of parts) {
      if (w.length <= 40 && re.test(w)) {
        valid.push(w);
      } else {
        skipped++;
      }
    }

    return { valid, skipped };
  },

  onAddInputChange(e) {
    const value = e.detail.value;
    const { valid, skipped } = this.parseInput(value);
    this.setData({
      addInput: value,
      parsedWords: valid,
      skippedCount: skipped,
    });
  },

  onCloseAddModal() {
    this.setData({
      showAddModal: false,
      addInput: '',
      parsedWords: [],
      skippedCount: 0,
      keyboardHeight: 0,
    });
  },

  noop() {},

  onConfirmAdd() {
    const newWords = this.data.parsedWords;
    if (newWords.length === 0) {
      wx.showToast({ title: '请输入单词', icon: 'none' });
      return;
    }

    const existingTexts = this.data.wordList.map((w) => w.text);
    const seen = new Set();
    const uniqueNewWords = [];
    for (const w of newWords) {
      if (!existingTexts.includes(w) && !seen.has(w)) {
        uniqueNewWords.push(w);
        seen.add(w);
      }
    }

    if (uniqueNewWords.length === 0) {
      wx.showToast({ title: '单词已全部存在', icon: 'none' });
      return;
    }

    const baseTime = Date.now();
    const newItems = uniqueNewWords.map((text, idx) => ({
      wordId: 'tmp_' + baseTime + '_' + idx,
      text: text,
      cn: '',
    }));

    const list = [...this.data.wordList, ...newItems];
    const newTotal = list.length;
    let newTakeCount = this.data.takeCount;

    if (this.data.takeCount === this.data.totalWords) {
      newTakeCount = newTotal;
    } else if (newTakeCount > newTotal) {
      newTakeCount = newTotal;
    }

    this.setData({
      wordList: list,
      totalWords: newTotal,
      takeCount: newTakeCount,
    });

    this.onCloseAddModal();

    wx.nextTick(() => {
      this.updateItemRects();
    });

    const dupCount = newWords.length - uniqueNewWords.length;
    let toastMsg = `已添加 ${uniqueNewWords.length} 个单词`;
    if (dupCount > 0) {
      toastMsg += `，跳过 ${dupCount} 个重复`;
    }
    wx.showToast({ title: toastMsg, icon: 'none' });
  },

  onClearInput() {
    this.setData({
      addInput: '',
      parsedWords: [],
      skippedCount: 0,
    });
  },

  onTextareaFocus(e) {
    const h = (e.detail && e.detail.height) || 0;
    this.setData({ keyboardHeight: h });
  },

  onTextareaBlur() {
    this.setData({ keyboardHeight: 0 });
  },
})