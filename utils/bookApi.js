// utils/bookApi.js
import CryptoJS from 'crypto-js';

const BASE = getApp().globalData.baseUrl;

/**
 * 解密课程数据
 * @param {string} encryptedBase64 - 服务端返回的 Base64 密文
 * @param {string} bid - 课本 id，如 b11
 * @returns {object} 课程 JSON 对象
 */
function decryptBook(encryptedBase64, bid) {
  // 密钥 = md5(bid) 的 16 字节
  const key = CryptoJS.MD5(bid);

  const decrypted = CryptoJS.AES.decrypt(encryptedBase64, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  const text = decrypted.toString(CryptoJS.enc.Utf8);
  if (!text) throw new Error('解密失败');

  return JSON.parse(text);
}

/**
 * 请求 + 解密，返回 { promise, task }
 * task 用于页面卸载时 abort
 */
function getBook(bid) {
  let task = null;
  const promise = new Promise((resolve, reject) => {
    task = wx.request({
      url: BASE + '/api/book?bid=' + bid,
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error('网络异常 ' + res.statusCode));
        }
        const result = res.data;
        if (!result || result.code !== '0') {
          return reject(new Error((result && result.msg) || '加载失败'));
        }
        try {
          const book = decryptBook(result.data, bid);
          resolve(book);
        } catch (e) {
          reject(e);
        }
      },
      fail: reject,
    });
  });
  return { promise, task };
}

/**
 * 请求词库 + 解密
 * 返回 { grade1Extra: [...], total: [...], gradeEnd: {...} }
 */
function getWordbank() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + '/api/wordbank',
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error('网络异常 ' + res.statusCode));
        }
        const result = res.data;
        if (!result || result.code !== '0') {
          return reject(new Error((result && result.msg) || '加载失败'));
        }
        try {
          const bank = decryptBook(result.data, 'wordbank');
          resolve(bank);
        } catch (e) {
          reject(e);
        }
      },
      fail: reject,
    });
  });
}

module.exports = { getBook, decryptBook, getWordbank };