# 第三方组件

## jsQR 1.4.0

- 用途：本机离线 QR 识别。
- 上游：[cozmo/jsQR](https://github.com/cozmo/jsQR)。固定分发源：`https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js`。
- 随包源码：`js/vendor/jsQR.js`；Apache-2.0 许可证：[jsQR.LICENSE](../js/vendor/jsQR.LICENSE)。分发文件保持原样，运行时不加载 CDN。
- 测试 QR 使用公开测试密钥，矩阵保存在 `tools/fixtures/qr-public.json`，由 qrcode-generator 1.4.4 一次性生成；该生成器不随插件分发。
