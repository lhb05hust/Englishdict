// utils/storage.js

const stg_key = {
  dict_rcds: "dict_records", // 听写记录
  words_book: "words_book",       // 全局生词池
  errs_book: "errs_book",         // 错误词
  dict_setting: "dict_setting",       // 听写语速/循环设置
  selected_bid: "selected_bid",       // 上次选中的课本 id
  en_selected_ver: "en_selected_ver", // 【英语版】上次选中的教材版本
  en_selected_bid: "en_selected_bid"  // 【英语版】上次选中的册号
};

const MAX_RECORDS = 100;

let _idCounter = 0;

function generateId(prefix = 'w') {
  return `${prefix}_${Date.now()}_${_idCounter++}`;
}

/**
 * 英文词条归一化：trim / 转小写 / 连续空格压成一个
 * cn 只做格式处理：去换行、trim、压空格
 */
function normText(s) {
  return String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s{2,}/g, ' ');
}

function normCn(s) {
  return String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/\s{2,}/g, ' ');
}

//词语总本操作
/**
 * 批量入库（幂等），支持多释义追加
 * @param {{text:string, cn:string}[]} items
 * @returns {{added:number, merged:number}}
 *
 * 重复处理规则：
 * 1. 新 cn 为空 -> 忽略
 * 2. 旧 cn 为空 -> 填新 cn
 * 3. 新旧相等 -> 跳过
 * 4. 一方包含另一方 -> 取长的
 * 5. 否则 -> 旧 + '；' + 新
 */
function addWordsBatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { added: 0, merged: 0 };
  }

  const words = getAllWords();
  const text2WIdMap = getApp().globalData.text2WIdMap;
  const wId2TextMap = getApp().globalData.wId2TextMap;

  const id2Idx = {};
  for (let i = 0; i < words.length; i++) {
    id2Idx[words[i].wordId] = i;
  }

  let added = 0;
  let merged = 0;

  for (const it of items) {
    const text = normText(it?.text);
    if (!text) continue;

    const newCn = normCn(it?.cn);
    const existId = text2WIdMap[text];

    if (existId) {
      const idx = id2Idx[existId];
      if (idx !== undefined) {
        const oldCn = words[idx].cn || '';
        let finalCn = oldCn;

        if (newCn) {
          if (!oldCn) {
            finalCn = newCn;
          } else if (oldCn === newCn) {
            // 跳过
          } else if (oldCn.includes(newCn)) {
            finalCn = oldCn;
          } else if (newCn.includes(oldCn)) {
            finalCn = newCn;
          } else {
            finalCn = oldCn + '；' + newCn;
          }
        }

        if (finalCn !== oldCn) {
          words[idx].cn = finalCn;
          merged++;
        }
      }
    } else {
      const tid = generateId('w');
      const entry = { wordId: tid, text, cn: newCn };
      words.push(entry);
      id2Idx[tid] = words.length - 1;
      text2WIdMap[text] = tid;
      wId2TextMap[tid] = text;
      added++;
    }
  }

  wx.setStorageSync(stg_key.words_book, words);
  return { added, merged };
}

function getAllWords() {
  return wx.getStorageSync(stg_key.words_book) || [];
}

////////////错题本操作，错题本用map保存////////////////////
/**
 * 添加或更新错题
 * @param {string} wordId - 词语ID
 * @param {number} initialCount - 初始错误次数
 */
function addWrongWord(wordId, initialCount = 1) {
  if (!wordId) {
    return { success: false, message: '词语ID不能为空' };
  }
  if (!(wordId in getApp().globalData.wId2TextMap)) {
    console.log('该词语不存在，无法加入错题本');
    return { success: false, message: '该词语不存在，无法加入错题本' };
  }
  const wrongsMap = wx.getStorageSync(stg_key.errs_book) || {};
  const existing = wrongsMap[wordId];

  if (existing) {
    existing.errorCount += initialCount;
    existing.lastWrongAt = Date.now();
    wx.setStorageSync(stg_key.errs_book, wrongsMap);
    console.log('错题次数已更新');
    return { success: true, message: '错题次数已更新', data: existing };
  } else {
    const newItem = {
      wordId: wordId,
      errorCount: initialCount,
      lastWrongAt: Date.now(),
      createdAt: Date.now(),
      mastered: false
    };
    wrongsMap[wordId] = newItem;
    wx.setStorageSync(stg_key.errs_book, wrongsMap);
    console.log('已加入错题本');
    return { success: true, message: '已加入错题本', data: newItem };
  }
}

/**
 * 标记错题为已掌握
 * @param {string} wrongId - 错题条目ID（实际为 wordId）
 * @returns {boolean}
 */
function markMastered(wrongId) {
  const wrongsMap = wx.getStorageSync(stg_key.errs_book) || {};
  const item = wrongsMap[wrongId];
  if (!item) return false;
  item.mastered = true;
  wx.setStorageSync(stg_key.errs_book, wrongsMap);
  return true;
}

/**
 * 取消标记已掌握（移回待复习）
 * @param {string} wrongId - 错题条目ID（实际为 wordId）
 * @returns {boolean}
 */
function unmarkMastered(wrongId) {
  const wrongsMap = wx.getStorageSync(stg_key.errs_book) || {};
  const item = wrongsMap[wrongId];
  if (!item) return false;
  item.mastered = false;
  wx.setStorageSync(stg_key.errs_book, wrongsMap);
  return true;
}

/**
 * 获取错题本列表（关联词语文本，按指定规则排序）
 * @param {string} sortBy - 排序方式：'errorCount' 或 'newest'
 * @returns {Array} 错题列表
 */
function getWrongWords(sortBy = 'errorCount') {
  const wrongsMap = wx.getStorageSync(stg_key.errs_book) || {};
  const wordMap = getApp().globalData.wId2TextMap;
  console.log(wrongsMap);

  // 构建 wordId -> cn 映射（从 words_book 里取）
  const wid2Cn = {};
  const words = getAllWords();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w && w.wordId) {
      wid2Cn[w.wordId] = w.cn || '';
    }
  }

  const result = Object.values(wrongsMap)
    .filter(item => wordMap[item.wordId])
    .map(item => ({
      wordId: item.wordId,
      text: wordMap[item.wordId],
      cn: wid2Cn[item.wordId] || '',
      errorCount: item.errorCount,
      lastWrongAt: item.lastWrongAt,
      createdAt: item.createdAt || item.lastWrongAt,
      mastered: item.mastered,
    }));

  if (sortBy === 'errorCount') {
    result.sort((a, b) => b.errorCount - a.errorCount);
  } else if (sortBy === 'newest') {
    result.sort((a, b) => b.createdAt - a.createdAt);
  }
  return result;
}

/**
 * 从错题本中移除指定条目
 * @param {string} wrongId - 错题条目ID（实际为 wordId）
 * @returns {object} 操作结果 { success, message }
 */
function removeWrongWord(wrongId) {
  if (!wrongId) {
    return { success: false, message: '错题ID不能为空' };
  }
  const wrongsMap = wx.getStorageSync(stg_key.errs_book) || {};
  if (!(wrongId in wrongsMap)) {
    return { success: false, message: '未找到该错题条目' };
  }
  delete wrongsMap[wrongId];
  wx.setStorageSync(stg_key.errs_book, wrongsMap);
  return { success: true, message: '已移除错题' };
}

function getWordId(text) {
  const t = normText(text);
  if (!t) return null;
  let tid = getApp().globalData.text2WIdMap[t];
  if (!tid) {
    return null;
  }
  return tid;
}

function getTextById(id) {
  if (!id) {
    return '';
  }
  return getApp().globalData.wId2TextMap[id] || '';
}

/**
 * 添加一条听写记录（自动维护最近 100 条的滑动窗口）
 * @param {Array} wordList - 听写词语列表 [{wordId, text, isError}...]
 * @param {number} errCount - 错误词语数量
 */
function addDictRecord(wordList, errCount) {
  if (!wordList || wordList.length <= 0) {
    return null;
  }
  const recordsMap = getDictRecords();
  const rId = generateId('rcd');

  recordsMap[rId] = {
    rId: rId,
    wordList: wordList,
    errCount: errCount,
    timestamp: Date.now()
  };

  const keys = Object.keys(recordsMap);
  if (keys.length > MAX_RECORDS) {
    let oldestRId = null;
    let oldestTime = Infinity;
    for (const key of keys) {
      if (recordsMap[key].timestamp < oldestTime) {
        oldestTime = recordsMap[key].timestamp;
        oldestRId = key;
      }
    }
    if (oldestRId) {
      delete recordsMap[oldestRId];
    }
  }

  wx.setStorage({
    key: stg_key.dict_rcds,
    data: recordsMap,
    fail: (err) => console.error('保存听写记录失败:', err)
  });

  return recordsMap[rId];
}

/**
 * 获取所有听写记录
 * @returns {Object} 听写记录 map
 */
function getDictRecords() {
  return wx.getStorageSync(stg_key.dict_rcds) || {};
}

function getDictRecordById(rId) {
  if (!rId) {
    return null;
  }
  let recordMap = getDictRecords();
  return recordMap[rId] || null;
}

/**
 * 删除指定的听写记录
 * @param {string} rId - 记录的唯一ID
 * @returns {boolean} 是否删除成功
 */
function removeDictRecord(rId) {
  if (!rId) return false;
  const recordsMap = getDictRecords();
  if (!(rId in recordsMap)) return false;
  delete recordsMap[rId];
  wx.setStorageSync(stg_key.dict_rcds, recordsMap);
  return true;
}

////////////教材选择记忆////////////////////
/**
 * 保存上次选中的课本 id
 * @param {string} bid - 课本 id，如 'b51'
 */
function saveSelectedBid(bid) {
  if (!bid) return false;
  try {
    wx.setStorageSync(stg_key.selected_bid, bid);
    return true;
  } catch (e) {
    console.warn('保存选册 bid 失败', e);
    return false;
  }
}

/**
 * 读取上次选中的课本 id
 * @returns {string} bid 或 ''
 */
function getSelectedBid() {
  try {
    return wx.getStorageSync(stg_key.selected_bid) || '';
  } catch (e) {
    console.warn('读取选册 bid 失败', e);
    return '';
  }
}

/**
 * 清除选册记忆
 */
function clearSelectedBid() {
  try {
    wx.removeStorageSync(stg_key.selected_bid);
    return true;
  } catch (e) {
    console.warn('清除选册 bid 失败', e);
    return false;
  }
}

////////////【英语版】教材选择记忆////////////////////
/**
 * 保存上次选中的教材版本
 * @param {string} ver - 版本标识，如 'rjb_pep'
 */
function saveEnSelectedVer(ver) {
  if (!ver) return false;
  try {
    wx.setStorageSync(stg_key.en_selected_ver, ver);
    return true;
  } catch (e) {
    console.warn('保存选册 ver 失败', e);
    return false;
  }
}

/**
 * 读取上次选中的教材版本
 * @returns {string} ver 或 ''
 */
function getEnSelectedVer() {
  try {
    return wx.getStorageSync(stg_key.en_selected_ver) || '';
  } catch (e) {
    console.warn('读取选册 ver 失败', e);
    return '';
  }
}

/**
 * 清除选册版本记忆
 */
function clearEnSelectedVer() {
  try {
    wx.removeStorageSync(stg_key.en_selected_ver);
    return true;
  } catch (e) {
    console.warn('清除选册 ver 失败', e);
    return false;
  }
}

/**
 * 保存上次选中的英语册号
 * @param {string} bid - 册号，如 'b31' / 'b101'
 */
function saveEnSelectedBid(bid) {
  if (!bid) return false;
  try {
    wx.setStorageSync(stg_key.en_selected_bid, bid);
    return true;
  } catch (e) {
    console.warn('保存英语选册 bid 失败', e);
    return false;
  }
}

/**
 * 读取上次选中的英语册号
 * @returns {string} bid 或 ''
 */
function getEnSelectedBid() {
  try {
    return wx.getStorageSync(stg_key.en_selected_bid) || '';
  } catch (e) {
    console.warn('读取英语选册 bid 失败', e);
    return '';
  }
}

/**
 * 清除英语选册记忆
 */
function clearEnSelectedBid() {
  try {
    wx.removeStorageSync(stg_key.en_selected_bid);
    return true;
  } catch (e) {
    console.warn('清除英语选册 bid 失败', e);
    return false;
  }
}

module.exports = {
  addWordsBatch,
  getAllWords,
  getWordId,
  getTextById,
  addWrongWord,
  getWrongWords,
  removeWrongWord,
  markMastered,
  unmarkMastered,
  addDictRecord,
  getDictRecords,
  getDictRecordById,
  removeDictRecord,
  saveSelectedBid,
  getSelectedBid,
  clearSelectedBid,
  // 【英语版】教材选择记忆
  saveEnSelectedVer,
  getEnSelectedVer,
  clearEnSelectedVer,
  saveEnSelectedBid,
  getEnSelectedBid,
  clearEnSelectedBid,
}