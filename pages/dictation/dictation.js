const lStore = require("../../utils/localStore");

/** 英文词条归一化：trim / 转小写 / 连续空格压成一个 */
function normText(s) {
  return String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\'\s*/g, "'")
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
    order: 'sequential',
    times: 2,
    interval: 5,
    customSeconds: 10,
    takeCount: 0,
    totalWords: 0,
    showAddModal: false,
    addInput: '',
    parsedWords: [],
    skippedCount: 0,
    keyboardHeight: 0,
    showAdd: false,
    showSettings: false
  },

  itemRects: [],
  dragOffsetX: 0,
  dragOffsetY: 0,

  // 存储进入页面时的初始状态
  originalRId: '',
  originalWordList: [],

  onLoad(options) {
    // 只记录传进来的 rId
    this.originalRId = options.rId || '';

    this.setData({ showAdd: options.showAdd || false });
  
    let rawList = [];
    const app = getApp();
    
    if (app.globalData.tempWordList && app.globalData.tempWordList.length > 0) {
      // 1. 从全局变量读取（教材页跳转）
      rawList = app.globalData.tempWordList;
      app.globalData.tempWordList = null;
    } else if (options.words) {
      // 2. 从 URL 传参读取（结果页重听错词等）
      let ocrData = null;
      try {
        ocrData = JSON.parse(options.words);
      } catch (e) {
        ocrData = null;
      }
      rawList = extractWordList(ocrData);
    } else if (this.originalRId) {
      // 3. 【核心修复】从缓存里读取历史未完成的记录
      const record = lStore.getDictRecordById(this.originalRId);
      if (record && record.wordList) {
        // 因为下面 map 里写的是 item.en || item.text，所以直接把 wordList 赋值即可
        rawList = record.wordList; 
      }
    }
  
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

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings });
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

  onDragStart(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.wordList[index];
    if (!item) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;

    this.updateItemRects(() => {
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
    });
  },

  onDragMove(e) {
    if (!this.data.isDragging) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const newX = touch.clientX - this.dragOffsetX;
    const newY = touch.clientY - this.dragOffsetY;

    this.setData({ ghostX: newX, ghostY: newY });

    const centerX = newX + this.data.ghostW / 2;
    const centerY = newY + this.data.ghostH / 2;

    let targetIndex = -1;
    for (let i = 0; i < this.itemRects.length; i++) {
      const r = this.itemRects[i];
      if (centerX >= r.left && centerX <= r.right && centerY >= r.top && centerY <= r.bottom) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex !== -1) {
      const currentIndex = this.data.wordList.findIndex((it) => it.wordId === this.data.draggingId);
      if (targetIndex !== currentIndex) {
        this.swapItems(currentIndex, targetIndex);
      }
    }
  },

  swapItems(fromIndex, toIndex) {
    const wordList = [...this.data.wordList];
    const temp = wordList[fromIndex];
    wordList[fromIndex] = wordList[toIndex];
    wordList[toIndex] = temp;
    this.setData({ wordList });
    wx.nextTick(() => { this.updateItemRects(); });
  },

  onDragEnd() {
    this.setData({ isDragging: false, draggingId: null, ghostItem: null });
  },

  onDelete(e) {
    const index = e.currentTarget.dataset.index;
    const list = this.data.wordList;
    list.splice(index, 1);
    const newTotal = list.length;
    let newTakeCount = this.data.takeCount;
    if (newTakeCount > newTotal || newTakeCount == this.data.totalWords) {
      newTakeCount = newTotal;
    }
    this.setData({ wordList: list, totalWords: newTotal, takeCount: newTakeCount });
    wx.nextTick(() => { this.updateItemRects(); });
  },

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

  onOrderChange(e) { this.setData({ order: e.currentTarget.dataset.value }); },
  onTimesChange(e) { this.setData({ times: parseInt(e.currentTarget.dataset.value, 10) }); },

  onIntervalChange(e) {
    const value = e.currentTarget.dataset.value;
    const realValue = value === 'custom' ? 'custom' : parseInt(value, 10);
    this.setData({ interval: realValue });
    if (realValue === 'custom') this.onCustomTap();
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
          if (seconds > 0) this.setData({ customSeconds: seconds });
          else wx.showToast({ title: '请输入有效的秒数', icon: 'none' });
        }
      },
    });
  },

  onTakeCountChanging(e) { this.setData({ takeCount: e.detail.value }); },
  onTakeCountChange(e) { this.setData({ takeCount: e.detail.value }); },

  onConfirm() {
    if (this.data.wordList.length === 0) {
      wx.showToast({ title: '请至少添加一个单词', icon: 'none' });
      return;
    }
  
    // 1. 先把词全部入库（幂等：已存在的会 merge cn，不存在的会新建并生成 w_xxx）
    lStore.addWordsBatch(
      this.data.wordList.map(item => ({ text: item.text, cn: item.cn || '' }))
    );
  
    // 2. 构建带真实 wordId 的 wordList
    //    getWordId 内部会 normText，与 addWordsBatch 入库时的 key 口径一致
    const finalWordList = this.data.wordList.map(item => ({
      wordId: lStore.getWordId(item.text) || item.wordId,  // 兜底：极端情况保留 tmp_
      text: item.text,
      cn: item.cn || ''
    }));
  
    // 3. 写入记录（此刻 wordId 已是 w_xxx）
    let finalRId = '';
    if (this.originalRId) {
      lStore.updateDictRecord(this.originalRId, 0, 'ongoing', finalWordList);
      finalRId = this.originalRId;
    } else {
      finalRId = lStore.addDictRecord(finalWordList, 0, 'ongoing');
    }
  
    const takeCount = Math.min(this.data.takeCount, this.data.totalWords);
    const gap = this.data.interval === 'custom' ? this.data.customSeconds : this.data.interval;
  
    // 4. 传给 play 的也用 finalWordList（保持一致，play 里 finalList 展开后就是 w_xxx）
    getApp().globalData.dictConfig = {
      rId: finalRId,
      wordList: finalWordList,
      readOrder: this.data.order,
      readTimes: this.data.times,
      gap: gap,
      takeCount: takeCount
    };
  
    wx.navigateTo({ url: "/pages/play/play" });
  
    // 原来的 setTimeout(addWordsBatch) 可以删掉了 —— 上面已经同步做过了
  },

  onShareAppMessage(res) { return { title: getApp().globalData.appName, path: "/pages/index/index" }; },
  onShareTimeline() { return { title: getApp().globalData.appName, query: "" }; },

  onAddNew() {
    this.setData({ showAddModal: true, addInput: '', parsedWords: [], skippedCount: 0 });
  },

  onPasteFromClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const clipText = (res.data || '').trim();
        if (!clipText) {
          wx.showToast({ title: '请先复制单词再来粘贴', icon: 'none', duration: 2000 });
          return;
        }
        const oldVal = this.data.addInput || '';
        const merged = oldVal ? (oldVal + '\n' + clipText) : clipText;
        const input = merged.slice(0, 150);
        const { valid, skipped } = this.parseInput(input);
        this.setData({ addInput: input, parsedWords: valid, skippedCount: skipped });
      },
      fail: () => { wx.showToast({ title: '请先复制单词再来粘贴', icon: 'none', duration: 2000 }); },
    });
  },

  parseInput(text) {
    if (!text) return { valid: [], skipped: 0 };
    const parts = text.split(/[\n,，、;；]+/).map((w) => normText(w)).filter((w) => w);
    if (parts.length === 0) return { valid: [], skipped: 0 };
    const valid = [];
    let skipped = 0;
    const re = /^[a-z][a-z\s'\-]*$/;
    for (const w of parts) {
      if (w.length <= 40 && re.test(w)) valid.push(w);
      else skipped++;
    }
    return { valid, skipped };
  },

  onAddInputChange(e) {
    const value = e.detail.value;
    const { valid, skipped } = this.parseInput(value);
    this.setData({ addInput: value, parsedWords: valid, skippedCount: skipped });
  },

  onCloseAddModal() {
    this.setData({ showAddModal: false, addInput: '', parsedWords: [], skippedCount: 0, keyboardHeight: 0 });
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
    const newItems = uniqueNewWords.map((text, idx) => ({ wordId: 'tmp_' + baseTime + '_' + idx, text: text, cn: '' }));
    const list = [...this.data.wordList, ...newItems];
    const newTotal = list.length;
    let newTakeCount = this.data.takeCount;

    if (this.data.takeCount === this.data.totalWords) newTakeCount = newTotal;
    else if (newTakeCount > newTotal) newTakeCount = newTotal;

    this.setData({ wordList: list, totalWords: newTotal, takeCount: newTakeCount });
    this.onCloseAddModal();
    wx.nextTick(() => { this.updateItemRects(); });

    const dupCount = newWords.length - uniqueNewWords.length;
    let toastMsg = `已添加 ${uniqueNewWords.length} 个单词`;
    if (dupCount > 0) toastMsg += `，跳过 ${dupCount} 个重复`;
    wx.showToast({ title: toastMsg, icon: 'none' });
  },

  onClearInput() { this.setData({ addInput: '', parsedWords: [], skippedCount: 0 }); },
  onTextareaFocus(e) { this.setData({ keyboardHeight: (e.detail && e.detail.height) || 0 }); },
  onTextareaBlur() { this.setData({ keyboardHeight: 0 }); },
})