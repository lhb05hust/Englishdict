// utils/bookApi.js
import CryptoJS from 'crypto-js';

const BASE = getApp().globalData.baseUrl;

/**
 * 解密英语教材数据
 * @param {string} encryptedBase64 服务端返回的 Base64 密文
 * @param {string} bid 册号，如 b31 / b101 / b121
 */
function decryptBook(encryptedBase64, bid) {
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
 * 请求 + 解密英语教材
 * @param {string} ver 版本，如 rjb_pep
 * @param {string} bid 册号，如 b31 / b101
 * @returns {{promise, task}} task 用于 abort
 */
function getBook(ver, bid) {
  let task = null;
  const promise = new Promise((resolve, reject) => {
    task = wx.request({
      url: BASE + '/en/book?ver=' + encodeURIComponent(ver) + '&bid=' + encodeURIComponent(bid),
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

module.exports = { getBook, decryptBook };