const app = getApp();
function request(url, method = "GET", data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.baseUrl + url,
      method,
      data,
      header: {
        "content-type": "application/json",
        "local-user-id": app.globalData.localUserId
      },
      success: res => resolve(res.data),
      fail: err => {
        wx.showToast({ title: "网络请求失败", icon: "none" });
        reject(err);
      }
    });
  });
}
module.exports = { request };