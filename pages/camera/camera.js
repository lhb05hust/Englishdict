// pages/camera/camera.js
const app = getApp();

Page({
  data: {
    cameraWidth: 0,
    cameraHeight: 0,
    statusBarHeight: 0,
    cameraSide: 'back',     // 'back' 或 'front'
    flipAnim: false,        // 控制翻转动画

    isNotFullScreen: false,   //非全面屏 false
  },

  onLoad() {
    this.getStatusBarHeight();
    this.calcCameraSize();
    wx.onWindowResize(() => {
      this.calcCameraSize();
    });
  },

  getStatusBarHeight() {
    const winInfo = wx.getWindowInfo();
    console.log(winInfo.statusBarHeight);
    this.setData({
      statusBarHeight: winInfo.statusBarHeight || 24,
    });
  },

  calcCameraSize() {
    const sysInfo = wx.getSystemInfoSync();
    const screenWidth = sysInfo.windowWidth;
    const width = screenWidth * 1;
    const height = width * 1.35;
    this.setData({
      cameraWidth: width,
      cameraHeight: height,
      isNotFullScreen: (sysInfo.screenHeight / sysInfo.screenWidth) < 1.8,
    });
  },

  // 拍照
  takePhoto() {
    const ctx = wx.createCameraContext();
    ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        // 保存为持久化文件，便于后续使用
        wx.saveFile({
          tempFilePath: res.tempImagePath,
          success: (saveRes) => {
            app.globalData.tempImagePath = saveRes.savedFilePath;
            wx.navigateTo({
              url: '/pages/crop/crop',
            });
          },
          fail: () => {
            wx.showToast({ title: '保存图片失败', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        console.error('拍照失败:', err);
        wx.showToast({ title: '拍照失败，请重试', icon: 'none' });
      },
    });
  },

  // 翻转摄像头（带动画）
  toggleCamera() {
    // 先触发翻转动画（按钮旋转 180°）
    this.setData({ flipAnim: true });
    // 稍后切换摄像头
    setTimeout(() => {
      const target = this.data.cameraSide === 'back' ? 'front' : 'back';
      this.setData({
        cameraSide: target,
      });
      // 动画结束后移除 flip 类（可选，用于下次点击重新触发）
      setTimeout(() => {
        this.setData({ flipAnim: false });
      }, 300);
    }, 100);
  },

  // 关闭界面
  closeCamera() {
    wx.navigateBack();
  },

  onCameraError(e) {
    console.error('相机错误:', e.detail);
    wx.showToast({ title: '相机不可用，请检查权限', icon: 'none' });
  },

  onUnload() {
    wx.offWindowResize();
  }
});