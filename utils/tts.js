// utils/tts.js
const CACHE_DIR = `${wx.env.USER_DATA_PATH}/tts_cache_en`;

// LRU 阈值：缓存文件数超过此值时，删除最旧的一批
const CACHE_MAX_FILES = 1000;

// 缓存文件最小有效字节数：低于此值判为损坏
const MIN_VALID_BYTES = 1024;

// 全局记录当前的网络请求任务，用于取消
let currentRequestTask = null;

// ----- 异步确保缓存目录存在 -----
function ensureCacheDir() {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    fs.access({
      path: CACHE_DIR,
      success: () => resolve(),
      fail: () => {
        fs.mkdir({
          dirPath: CACHE_DIR,
          recursive: true,
          success: () => resolve(),
          fail: (err) => reject(err)
        });
      }
    });
  });
}

// 生成缓存文件路径（安全）
function getCacheFilePath(text) {
  const safeName = encodeURIComponent(text).replace(/%/g, '_');
  return `${CACHE_DIR}/${safeName}.mp3`;
}

// 检查文件是否存在且有效（size > MIN_VALID_BYTES 才算有效）
function isValidCache(filePath) {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager();
    fs.getFileInfo({
      filePath: filePath,
      success: (res) => {
        resolve(res.size > MIN_VALID_BYTES);
      },
      fail: () => resolve(false)
    });
  });
}

/**
 * LRU 清理：文件数超过 CACHE_MAX_FILES 时，删除最旧的一批。
 * - 只在写文件成功后异步调用，不阻塞播放
 * - 只在文件数超出阈值时才做 stat（全量 stat 开销较高）
 * - 任何异常静默吞掉，不影响正常播放
 */
function enforceCacheLimit() {
  try {
    const fs = wx.getFileSystemManager();
    fs.readdir({
      dirPath: CACHE_DIR,
      success(res) {
        const files = res.files || [];
        if (files.length <= CACHE_MAX_FILES) return;

        const stats = [];
        let pending = files.length;
        let finished = false;

        const onOneDone = () => {
          if (--pending > 0) return;
          if (finished) return;
          finished = true;

          stats.sort((a, b) => a.mtime - b.mtime); // 最旧在前
          const needDel = stats.length - CACHE_MAX_FILES;
          if (needDel <= 0) return;

          const toDel = stats.slice(0, needDel);
          let wait = toDel.length;
          if (wait === 0) return;

          toDel.forEach(item => {
            fs.unlink({
              filePath: `${CACHE_DIR}/${item.name}`,
              complete() {
                if (--wait === 0) {
                  console.log('🗑️ LRU 清理完成，删除', toDel.length, '个旧缓存');
                }
              }
            });
          });
        };

        files.forEach(name => {
          fs.stat({
            path: `${CACHE_DIR}/${name}`,
            success(st) {
              const mtime = st.lastModifiedTime || st.lastAccessedTime || 0;
              stats.push({ name, mtime });
              onOneDone();
            },
            fail() {
              onOneDone();
            }
          });
        });
      },
      fail() {
        // 目录不存在或读失败，静默忽略
      }
    });
  } catch (e) {
    console.warn('enforceCacheLimit 异常:', e);
  }
}

// ----- 全局音频上下文 -----
let audioCtx = null;

/**
 * 文字转语音播报（含缓存 + 自动重试）
 * @param {String} text 待朗读的英文单词或短语
 * @param {Function} [onPlayEnd] 回调，err => {}
 * @param {Boolean} [isRetry] 内部参数：true 表示这是重试，不再继续重试
 */
async function speakWord(text, onPlayEnd, isRetry = false) {
  stopSpeak();

  // 最终回调包装：只在不再重试时弹失败 toast
  const finish = (err) => {
    if (err) {
      wx.showToast({ title: '语音播放失败', icon: 'none' });
    }
    if (typeof onPlayEnd === 'function') onPlayEnd(err);
  };

  try {
    await ensureCacheDir();
  } catch (e) {
    console.error('创建缓存目录失败:', e);
    return downloadAndPlay(text, finish, false);
  }

  const cachePath = getCacheFilePath(text);
  // 重试时强制走下载，不再信任缓存（上次缓存可能已被标记为坏）
  const valid = isRetry ? false : await isValidCache(cachePath);

  if (valid) {
    console.log('🔊 使用缓存:', text);
    playAudio(cachePath, text, (err) => {
      if (err && !isRetry) {
        // 缓存播放失败 → 自动重试一次（走下载路径）
        // 坏缓存文件已在 playAudio.onError 中删除
        console.log('🔄 缓存播放失败，自动重试下载:', text);
        speakWord(text, onPlayEnd, true);
        return;
      }
      finish(err);
    });
    return;
  }

  console.log('🌐 下载 TTS:', text);
  downloadAndPlay(text, finish, true, cachePath);
}

/**
 * 下载并播放 TTS（可选缓存）
 * - 响应数据 < MIN_VALID_BYTES 视为异常，不写缓存，用临时文件播放
 */
function downloadAndPlay(text, onPlayEnd, shouldCache = true, cachePath = null) {
  const app = getApp();
  if (currentRequestTask) {
    currentRequestTask.abort();
    currentRequestTask = null;
  }
  currentRequestTask = wx.request({
    url: app.globalData.baseUrl + "/en/tts",
    method: 'GET',
    data: { text: text },
    responseType: 'arraybuffer',
    success(res) {
      currentRequestTask = null;
      const byteLen = res.data ? res.data.byteLength : 0;
      console.log('下载原始数据大小:', byteLen, 'bytes');

      const fs = wx.getFileSystemManager();

      // ===== 数据太小：判为异常响应，不污染缓存，用临时文件播放 =====
      if (byteLen < MIN_VALID_BYTES) {
        console.warn('响应数据异常，不写缓存:', byteLen);
        const tmpPath = `${wx.env.USER_DATA_PATH}/tts_tmp_${Date.now()}.mp3`;
        fs.writeFile({
          filePath: tmpPath,
          data: res.data,
          success() {
            playAudio(tmpPath, text, onPlayEnd);
          },
          fail(err2) {
            console.error('临时文件写入失败:', err2);
            if (typeof onPlayEnd === 'function') onPlayEnd(err2);
          }
        });
        return;
      }
      // ============================================================

      const targetPath = cachePath || `${wx.env.USER_DATA_PATH}/tts_${Date.now()}.mp3`;
      fs.writeFile({
        filePath: targetPath,
        data: res.data,
        success() {
          if (shouldCache) {
            console.log('✅ 缓存写入成功:', text);
            enforceCacheLimit(); // 异步 LRU 检查，不阻塞播放
          }
          playAudio(targetPath, text, onPlayEnd);
        },
        fail(err) {
          console.error('写入文件失败:', err);
          // 尝试使用临时路径重试（不缓存）
          const fallbackPath = `${wx.env.USER_DATA_PATH}/tts_fallback_${Date.now()}.mp3`;
          fs.writeFile({
            filePath: fallbackPath,
            data: res.data,
            success() {
              console.log('📁 使用临时文件播放');
              playAudio(fallbackPath, text, onPlayEnd);
            },
            fail(err2) {
              console.error('二次写入失败:', err2);
              if (typeof onPlayEnd === 'function') onPlayEnd(err2);
            }
          });
        }
      });
    },
    fail(err) {
      if (err.errMsg && err.errMsg.includes('abort')) {
        console.warn('TTS请求已取消:', text);
        return;
      }
      console.error('请求TTS服务失败:', err);
      wx.showToast({ title: '语音服务请求失败', icon: 'none' });
      if (typeof onPlayEnd === 'function') onPlayEnd(err);
    }
  });
}

/**
 * 播放音频文件（统一播放逻辑）
 * - 播放失败时删除损坏的缓存文件（仅针对英文缓存目录）
 * - 不再内部弹 toast，由调用方决定是否弹
 */
function playAudio(filePath, text, onPlayEnd) {
  audioCtx = wx.createInnerAudioContext();
  audioCtx.src = filePath;
  audioCtx.volume = 1.0;
  audioCtx.play();

  audioCtx.onError((err) => {
    console.error('播放失败:', err);
    // 清理损坏的缓存文件（仅针对英文缓存目录）
    if (filePath && filePath.includes('tts_cache_en')) {
      try {
        wx.getFileSystemManager().unlinkSync(filePath);
        console.log('🗑️ 删除损坏缓存:', filePath);
      } catch (e) {
        // 忽略删除失败
      }
    }
    if (typeof onPlayEnd === 'function') onPlayEnd(err);
    if (audioCtx) {
      audioCtx.destroy();
      audioCtx = null;
    }
  });

  audioCtx.onEnded(() => {
    console.log('✅ 播放结束:', text);
    if (typeof onPlayEnd === 'function') onPlayEnd(null);
    if (audioCtx) {
      audioCtx.destroy();
      audioCtx = null;
    }
  });
}

/**
 * 停止当前播放
 */
function stopSpeak() {
  if (audioCtx) {
    audioCtx.stop();
    audioCtx.destroy();
    audioCtx = null;
  }

  if (currentRequestTask) {
    currentRequestTask.abort();
    currentRequestTask = null;
  }
}

function speakFinish() {
  stopSpeak();
  playAudio("/images/finish.mp3", "单词听写完毕,点击”确定“进行检查", () => {
    stopSpeak();
  });
}

/**
 * 清除所有缓存的音频文件（保留导出，供未来"我的"页面手动清理使用）
 * 注意：play.js 已不再自动调用此函数，改用 LRU 上限管理
 */
function clearCache() {
  const fs = wx.getFileSystemManager();
  fs.readdir({
    dirPath: CACHE_DIR,
    success(res) {
      res.files.forEach(file => {
        fs.unlink({
          filePath: `${CACHE_DIR}/${file}`,
          fail(err) {
            console.warn('删除缓存文件失败:', file, err);
          }
        });
      });
      console.log('🗑️ 缓存已清除，共删除', res.files.length, '个文件');
    },
    fail(err) {
      if (err.errMsg.includes('no such file or directory')) return;
      console.warn('读取缓存目录失败:', err);
    }
  });
}

module.exports = {
  speakWord,
  stopSpeak,
  speakFinish,
  clearCache
};