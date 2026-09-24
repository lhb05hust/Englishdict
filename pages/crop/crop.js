// pages/crop/crop.js
const app = getApp();
const cropW0 = 640 * 0.80;
const cropH0 = cropW0 * 8.9 / 6.55;
const CORSIZE = 44;
const IMGPX = 1080;

Page({
  data: {
    imagePath: '',
    ratio: 0,
    // 裁剪框状态
    crop: {
      x: 0, // 左上角 x rpx
      y: 0, // 左上角 y
      w: 0, // 宽度
      h: 0, // 高度
    },
    // 容器尺寸
    wrapper: {
      w: 0,
      h: 0,
    }, // rpx
    isNotFullScreen: false, // 默认全面屏
    showHint: true,
    cornerSize: CORSIZE, // 四个角的初始大小，rpx
    resButtonText: '重新拍照', // 默认值
    showHelpBtn: true, // 新增：控制 i 按钮显示
  },

  // 存储图片原始信息和显示信息
  imageInfo: null,
  wrapRect: null,  // image-wrap 的 boundingClientRect
  imgRect: null,   // image 的 boundingClientRect

  // 触摸状态缓存（不放入 data 避免频繁 setData）
  touchState: {
    type: null,       // 'box' | 'corner'
    corner: null,     // 'lt' | 'rt' | 'lb' | 'rb'
    startX: 0,
    startY: 0,
    startCrop: null,  // 触摸开始时的 crop 快照
  },

  // 旋转防连点标记
  _rotating: false,

  // 识别流程状态
  _busy: false,         // 是否正在执行识别全流程
  _cancelled: false,    // 流程是否已被用户主动取消
  _uploadTask: null,    // 上传任务引用，用于 abort

  onLoad(options) {
    const imagePath = app.globalData.tempImagePath;
    if (!imagePath) {
      wx.showToast({ title: '图片不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    wx.getImageInfo({
      src: imagePath,
      success: (res) => {
        this.imageInfo = res;
        const ratio = res.width / res.height;
        // 使用校验后的路径
        this.setData({
          imagePath: res.path,
          ratio: ratio,
        });
      },
      fail: () => {
        wx.showToast({ title: '图片无效，请重拍', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    });

    const sysInfo = wx.getSystemInfoSync();
    this.setData({
      isNotFullScreen: (sysInfo.screenHeight / sysInfo.screenWidth) < 1.8,
    });

    const isFromUpload = options && options.from === 'upload';
    this.setData({
      resButtonText: isFromUpload ? '重新上传' : '重新拍照'
    });
  },
  onUnload() {
    this._cancelled = true;
  },

  onReady() {
    setTimeout(() => {
      this.getWrapperSize();
      this.getDisplayRects();
    }, 100);

    // 在 onReady 里
    this.setData({ showBreath: true });
    setTimeout(() => this.setData({ showBreath: false }), 2500);
  },

  /**
   * 获取 image-wrap 和 image 的显示尺寸及位置
   */
// 替换原来的 getDisplayRects
getDisplayRects() {
  const query = wx.createSelectorQuery();
  query.select('#imageWrap').boundingClientRect((wrapRect) => {
    if (!wrapRect) {
      console.warn('未获取到 image-wrap');
      return;
    }
    this.wrapRect = wrapRect;

    // ===== 新增：计算图片内容实际显示的区域（模拟 aspectFit 居中）=====
    if (this.imageInfo) {
      const imgW = this.imageInfo.width;
      const imgH = this.imageInfo.height;
      const wrapW = wrapRect.width;
      const wrapH = wrapRect.height;

      // 计算缩放比例（等比缩放到容器内）
      const scale = Math.min(wrapW / imgW, wrapH / imgH);
      const contentW = imgW * scale;
      const contentH = imgH * scale;
      // 居中偏移量
      const offsetX = (wrapW - contentW) / 2;
      const offsetY = (wrapH - contentH) / 2;

      // 将 imgRect 设为图片内容的实际显示矩形（而非图片盒子的矩形）
      this.imgRect = {
        left: wrapRect.left + offsetX,
        top: wrapRect.top + offsetY,
        width: contentW,
        height: contentH
      };

      // 根据真实内容区域初始化裁剪框位置
      this.initCropPosition();
    }
  }).exec();
},

  rpxToPx(rpx) {
    const windowInfo = wx.getWindowInfo();
    return rpx * (windowInfo.windowWidth / 750);
  },

  pxToRpx(px) {
    const windowInfo = wx.getWindowInfo();
    return px * (750 / windowInfo.windowWidth);
  },

  // 设置裁剪初始位置
  // initCropPosition() {
  //   // 图片在 image-wrap 内的偏移
  //   const offsetX = this.pxToRpx(this.imgRect.left - this.wrapRect.left);
  //   const offsetY = this.pxToRpx(this.imgRect.top - this.wrapRect.top);
  //   const imgDisplayWidth = this.pxToRpx(this.imgRect.width);
  //   const imgDisplayHeight = this.pxToRpx(this.imgRect.height);
  //   // 框的左上角坐标（相对于 image-wrap）
  //   const boxX = offsetX + (imgDisplayWidth - cropW0) / 2;
  //   const boxY = offsetY + (imgDisplayHeight - cropH0) / 2;
  //   this.setData({
  //     crop: {
  //       x: boxX,
  //       y: boxY,
  //       w: cropW0,
  //       h: cropH0
  //     }
  //   });
  // },

    // 设置裁剪初始位置
    initCropPosition() {
      // 图片在 image-wrap 内的偏移
      const offsetX = this.pxToRpx(this.imgRect.left - this.wrapRect.left);
      const offsetY = this.pxToRpx(this.imgRect.top - this.wrapRect.top);
      const imgDisplayWidth = this.pxToRpx(this.imgRect.width);
      const imgDisplayHeight = this.pxToRpx(this.imgRect.height);
  
      // 动态计算裁剪框尺寸：占据图片显示区域的80%，并且保持和图片相同的长宽比
      const newW = imgDisplayWidth * 0.8;
      const newH = imgDisplayHeight * 0.8;
  
      // 居中计算
      const boxX = offsetX + (imgDisplayWidth - newW) / 2;
      const boxY = offsetY + (imgDisplayHeight - newH) / 2;

      // ===== 新增：动态调整圆角大小 =====
      // 判断图片的“短边”，短边越短，角应该越小（防止遮住文字）
      const shortSide = Math.min(imgDisplayWidth, imgDisplayHeight);
      // 按短边的10%计算，限制在 32~CORSIZErpx 之间
      const newCornerSize = Math.max(32, Math.min(CORSIZE, shortSide * 0.08));
  
      this.setData({
        crop: {
          x: boxX,
          y: boxY,
          w: newW,
          h: newH
        },
        cornerSize: newCornerSize
      });
    },

  // 获取容器尺寸
  getWrapperSize() {
    const query = wx.createSelectorQuery();
    query.select('#cropWrapper').boundingClientRect();
    query.exec((res) => {
      if (res[0]) {
        this.setData({
          'wrapper.w': this.pxToRpx(res[0].width),
          'wrapper.h': this.pxToRpx(res[0].height),
        });
      }
    });
  },

  // ========== 移动裁剪框 ==========
  onBoxTouchStart(e) {
    const touch = e.touches[0];
    this.touchState = {
      type: 'box',
      startX: touch.clientX,
      startY: touch.clientY,
      startCrop: { ...this.data.crop }, // 这里的值是 rpx
    };
  },

  onBoxTouchMove(e) {
    if (this.touchState.type !== 'box') return;
    const touch = e.touches[0];
    // 触摸差值是 px，转成 rpx 后再计算
    const dx = this.pxToRpx(touch.clientX - this.touchState.startX);
    const dy = this.pxToRpx(touch.clientY - this.touchState.startY);
    let newX = this.touchState.startCrop.x + dx;
    let newY = this.touchState.startCrop.y + dy;
    const { w: maxW, h: maxH } = this.data.wrapper;
    const { w, h } = this.data.crop;
    newX = Math.max(0, Math.min(newX, maxW - w));
    newY = Math.max(0, Math.min(newY, maxH - h));
    this.setData({
      'crop.x': newX,
      'crop.y': newY,
    });
  },

  // ========== 拖动圆角调整大小 ==========
  onCornerTouchStart(e) {
    const touch = e.touches[0];
    const corner = e.currentTarget.dataset.corner;
    this.touchState = {
      type: 'corner',
      corner: corner,
      startX: touch.clientX,
      startY: touch.clientY,
      startCrop: { ...this.data.crop },
    };
  },

  onCornerTouchMove(e) {
    if (this.touchState.type !== 'corner') return;
    const touch = e.touches[0];
    // px 差值转 rpx
    const dx = this.pxToRpx(touch.clientX - this.touchState.startX);
    const dy = this.pxToRpx(touch.clientY - this.touchState.startY);
    const { corner, startCrop } = this.touchState;
    const { w: maxW, h: maxH } = this.data.wrapper;
    let newX = startCrop.x;
    let newY = startCrop.y;
    let newW = startCrop.w;
    let newH = startCrop.h;
    switch (corner) {
      case 'lt':
        newX = startCrop.x + dx;
        newY = startCrop.y + dy;
        newW = startCrop.w - dx;
        newH = startCrop.h - dy;
        break;
      case 'rt':
        newY = startCrop.y + dy;
        newW = startCrop.w + dx;
        newH = startCrop.h - dy;
        break;
      case 'lb':
        newX = startCrop.x + dx;
        newW = startCrop.w - dx;
        newH = startCrop.h + dy;
        break;
      case 'rb':
        newW = startCrop.w + dx;
        newH = startCrop.h + dy;
        break;
    }
    const MIN_SIZE = 80; // 最小 100rpx
    if (newW < MIN_SIZE) {
      if (corner === 'lt' || corner === 'lb') {
        newX = startCrop.x + startCrop.w - MIN_SIZE;
      }
      newW = MIN_SIZE;
    }
    if (newH < MIN_SIZE) {
      if (corner === 'lt' || corner === 'rt') {
        newY = startCrop.y + startCrop.h - MIN_SIZE;
      }
      newH = MIN_SIZE;
    }
    // 边界限制（单位已经是 rpx）
    if (newX < 0) {
      newW += newX;
      newX = 0;
    }
    if (newY < 0) {
      newH += newY;
      newY = 0;
    }
    if (newX + newW > maxW) newW = maxW - newX;
    if (newY + newH > maxH) newH = maxH - newY;
    this.setData({
      'crop.x': newX,
      'crop.y': newY,
      'crop.w': newW,
      'crop.h': newH,
    });
  },

  onTouchEnd() {
    this.touchState = {
      type: null,
      corner: null,
      startX: 0,
      startY: 0,
      startCrop: null,
    };
  },

  // 重选图片
  reselectImage() {
    if (this._busy) this._cancelCurrentFlow(); //及时结束
    wx.navigateBack();
  },

  // 新增：直接退出，回到首页
  goHome() {
    if (this._busy) this._cancelCurrentFlow();//及时结束
    // 如果首页是 TabBar 页面，用 switchTab；如果不是，用 reLaunch 更彻底
    wx.reLaunch({
      url: '/pages/index/index'
    });
  },

  // 开始识别
  startRecognition() {
    if (this._busy) return;
    if (!this.imgRect || !this.wrapRect || !this.imageInfo) {
      wx.showToast({ title: '图片信息未就绪', icon: 'none' });
      return;
    }
    this._cancelled = false;                   // ← 每次开始时重置取消标记
    this._busy = true;                         // ← 进入忙碌状态
    wx.showLoading({ title: '裁剪中...' });
    this.cropImage();
  },

  /**
   * 裁剪图片
   */
  cropImage() {
    const imagePath = this.data.imagePath;
    const imgInfo = this.imageInfo;
    const wrapRect = this.wrapRect;
    const imgRect = this.imgRect;

    const boxLeft = this.rpxToPx(this.data.crop.x);
    const boxTop = this.rpxToPx(this.data.crop.y);
    const boxWPx = this.rpxToPx(this.data.crop.w);
    const boxHPx = this.rpxToPx(this.data.crop.h);

    // 图片在 wrap 中的偏移
    const offsetX = imgRect.left - wrapRect.left;
    const offsetY = imgRect.top - wrapRect.top;
    const imgDisplayWidth = imgRect.width;
    const imgDisplayHeight = imgRect.height;

    // 计算框在图片显示区域内的比例
    let leftRatio = (boxLeft - offsetX) / imgDisplayWidth;
    let topRatio = (boxTop - offsetY) / imgDisplayHeight;
    let widthRatio = boxWPx / imgDisplayWidth;
    let heightRatio = boxHPx / imgDisplayHeight;

    // 边界保护（防止超出图片显示区域）
    leftRatio = Math.max(0, Math.min(leftRatio, 1));
    topRatio = Math.max(0, Math.min(topRatio, 1));
    widthRatio = Math.min(widthRatio, 1 - leftRatio);
    heightRatio = Math.min(heightRatio, 1 - topRatio);

    // 换算到原始图片像素坐标
    let cropX = leftRatio * imgInfo.width;
    let cropY = topRatio * imgInfo.height;
    let cropW = widthRatio * imgInfo.width;
    let cropH = heightRatio * imgInfo.height;

    // 再次边界保护（整数）
    cropX = Math.floor(Math.max(0, Math.min(cropX, imgInfo.width - 1)));
    cropY = Math.floor(Math.max(0, Math.min(cropY, imgInfo.height - 1)));
    cropW = Math.floor(Math.min(cropW, imgInfo.width - cropX));
    cropH = Math.floor(Math.min(cropH, imgInfo.height - cropY));

    if (cropW <= 0 || cropH <= 0) {
      wx.hideLoading();
      this._busy = false; 
      wx.showToast({ title: '裁剪区域无效', icon: 'none' });
      return;
    }

    // 使用 Canvas 裁剪
    const query = wx.createSelectorQuery();
    query.select('#cropCanvas').node().exec((res) => {
      if (!res || !res[0]) {
        wx.hideLoading();
        this._busy = false;
        wx.showToast({ title: 'Canvas初始化失败', icon: 'none' });
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      canvas.width = cropW;
      canvas.height = cropH;
      const image = canvas.createImage();
      image.src = imagePath;
      image.onload = () => {
        // ===== 新增：检查是否已取消 =====
        if (this._cancelled) { wx.hideLoading(); return; }
        ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        wx.canvasToTempFilePath({
          canvas: canvas,
          success: (tempRes) => {
            // ===== 新增：检查是否已取消 =====
            if (this._cancelled) return;
            wx.hideLoading();
            this.compressAndUpload(tempRes.tempFilePath);
          },
          fail: (err) => {
            wx.hideLoading();
            this._busy = false; 
            wx.showToast({ title: '裁剪导出失败', icon: 'none' });
            console.error(err);
          }
        });
      };
      image.onerror = (err) => {
        wx.hideLoading();
        this._busy = false; 
        wx.showToast({ title: '图片加载失败', icon: 'none' });
        console.error(err);
      };
    });
  },

  // --- 压缩和上传（复用原逻辑）---
  compressAndUpload(originPath) {
    wx.showLoading({ title: '压缩图片中...' });
    wx.compressImage({
      src: originPath,
      quality: 70,
      maxWidth: IMGPX,
      maxHeight: IMGPX,
      success: (compressRes) => {
        if (this._cancelled) return; 
        this.uploadImage(compressRes.tempFilePath);
      },
      fail: () => {
        if (this._cancelled) return; 
        wx.showToast({ title: '压缩失败，原图上传', icon: 'none' });
        this.uploadImage(originPath);
      }
    });
  },

  uploadImage(tempFilePath) {
    wx.showLoading({ title: '识别分词中...' });
    this._uploadTask = wx.uploadFile({
      url: app.globalData.baseUrl + '/en/ocr',
      filePath: tempFilePath,
      name: 'file',
      header: {
        'local-user-id': app.globalData.localUserId
      },
      success: (uploadRes) => {
        this._uploadTask = null; 
        if (this._cancelled) { wx.hideLoading(); return; }
        wx.hideLoading();
        this._busy = false;
      
        let res;
        try {
          res = JSON.parse(uploadRes.data);
        } catch (e) {
          console.error('响应解析失败:', uploadRes.data);
          wx.showToast({ title: '服务异常，请重试', icon: 'none' });
          return;
        }
      
        // =====新增限流判断，仅此一段，其余全部原样保留====
        if (res.code === "BUSY") {
          wx.showToast({
            title: res.msg,
            icon: 'none',
            duration: 2500,
          })
          return;
        }
        //原有逻辑不变
        if (res.code !== '0') {
          wx.showToast({ title: '识别失败', icon: 'none' });
          return;
        }
        const wordList = res.data.wordList;
        if (!wordList || wordList.length === 0) {
          wx.showToast({ title: '未识别到词语', icon: 'none' });
          return;
        }
        wx.showToast({ title: '识别成功' });
        wx.navigateTo({
          url: `/pages/dictation/dictation?words=${JSON.stringify(wordList)}`
        });
      },
      fail: () => {
        this._uploadTask = null;
        if (this._cancelled) return;  
        wx.hideLoading();
        this._busy = false;
        wx.showToast({ title: '图片上传失败', icon: 'none' });
      }
    });
  },

  hideHint(e) {
    this.setData({ showHint: false });
  },

  // ===== 新增：图片左旋 / 右旋 =====
  onRotateLeft() {
    this._rotateImage(-1);   // 逆时针 90°
  },

  onRotateRight() {
    this._rotateImage(1);    // 顺时针 90°
  },

  /**
   * 物理旋转图片：用页面已有的 #cropCanvas 把当前图旋转90°导出为新图，
   * 更新 imagePath 并复用现有 getDisplayRects/initCropPosition 重新初始化裁框。
   * 因此触摸/裁剪坐标逻辑完全无需改动。
   */
  _rotateImage(dir) {
    if (this._rotating) return;          // 防连点
    if (!this.imageInfo) {
      wx.showToast({ title: '图片未就绪', icon: 'none' });
      return;
    }
    this._rotating = true;
    wx.showLoading({ title: '旋转中...', mask: true });

    const srcW = this.imageInfo.width;
    const srcH = this.imageInfo.height;

    wx.createSelectorQuery()
      .select('#cropCanvas')
      .node()
      .exec((res) => {
        if (!res || !res[0]) {
          wx.hideLoading();
          this._rotating = false;
          wx.showToast({ title: 'Canvas初始化失败', icon: 'none' });
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const image = canvas.createImage();

        image.src = this.data.imagePath;
        image.onload = () => {
          // 旋转后宽高互换
          canvas.width = srcH;
          canvas.height = srcW;
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (dir === 1) {
            // 顺时针90°：原图左上角 → 新图右上角
            ctx.translate(canvas.width, 0);
            ctx.rotate(Math.PI / 2);
          } else {
            // 逆时针90°：原图左上角 → 新图左下角
            ctx.translate(0, canvas.height);
            ctx.rotate(-Math.PI / 2);
          }
          ctx.drawImage(image, 0, 0, srcW, srcH);
          wx.canvasToTempFilePath({
            canvas: canvas,
            fileType: 'jpg',
            quality: 0.92,
            success: (r) => {
              // 获取新图信息（与 onLoad 流程一致）
              wx.getImageInfo({
                src: r.tempFilePath,
                success: (info) => {
                  // 更新图片信息，清空显示矩形缓存
                  this.imageInfo = info;
                  this.imgRect = null;
                  this.wrapRect = null;
                  this.setData({
                    imagePath: info.path,
                    ratio: info.width / info.height,
                  });
                  // 等图片重新布局后，复用现有方法重建显示矩形并重置裁框位置
                  setTimeout(() => {
                    this.getWrapperSize();
                    this.getDisplayRects();   // 内部会调 initCropPosition 重置裁框
                    wx.hideLoading();
                    this._rotating = false;
                  }, 150);
                },
                fail: () => {
                  wx.hideLoading();
                  this._rotating = false;
                  wx.showToast({ title: '旋转失败', icon: 'none' });
                },
              });
            },
            fail: () => {
              wx.hideLoading();
              this._rotating = false;
              wx.showToast({ title: '旋转导出失败', icon: 'none' });
            },
          });
        };
        image.onerror = () => {
          wx.hideLoading();
          this._rotating = false;
          this._busy = false; 
          wx.showToast({ title: '图片加载失败', icon: 'none' });
        };
      });
  },

  onShareAppMessage(res) {
    return {
      title: getApp().globalData.appName,
      path: "/pages/index/index"
    }
  },

  onShareTimeline() {
    return {
      title: getApp().globalData.appName,
      query: ""
    }
  },
  // 在 onRotateRight 函数后面，添加一个 showHelp 方法：
  showHelp() {
    wx.showModal({
      title: '摆正文字识别更准确',
      content: '如果图片里的文字是横着的，可以点击两侧的↺ / ↻ 按钮旋转图片。',
      showCancel: false,
      confirmText: '我知道了',
      confirmColor: '#033c81',
      success: (res) => {
        if (res.confirm) {
          // 点击“我知道了”后，隐藏 i 按钮
          this.setData({ showHelpBtn: false });
        }
      }
    });
  },

    // 取消当前识别流程（供"重新上传/退出/页面卸载"调用）
    _cancelCurrentFlow() {
      this._cancelled = true;
      this._busy = false;
      if (this._uploadTask) {
        try { this._uploadTask.abort(); } catch (e) {}
        this._uploadTask = null;
      }
      wx.hideLoading();
    },
});