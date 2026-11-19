# 第三方组件

## jsQR 1.4.0

- 用途：本机离线 QR 识别。
- 上游：[cozmo/jsQR](https://github.com/cozmo/jsQR)。固定分发源：`https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js`。
- 随包源码：`js/vendor/jsQR.js`；Apache-2.0 许可证：[jsQR.LICENSE](../js/vendor/jsQR.LICENSE)。分发文件保持原样，运行时不加载 CDN。
- 测试 QR 使用公开测试密钥，矩阵保存在 `tools/fixtures/qr-public.json`，由 qrcode-generator 1.4.4 一次性生成；该生成器不随插件分发。

## 平台 SVG 标识

- 用途：分类选择器、分类标签与分类筛选中的平台识别。所有路径内置于 `js/util.js`，运行时完全离线，不请求图标服务。
- ChatGPT（OpenAI 标识）、GitHub、Apple、YouTube、Discord、Telegram、X、Amazon、Facebook、Instagram 的矢量路径取自 [Simple Icons 13.21.0](https://github.com/simple-icons/simple-icons/tree/13.21.0/icons)，对应 `openai.svg`、`github.svg`、`apple.svg`、`youtube.svg`、`discord.svg`、`telegram.svg`、`x.svg`、`amazon.svg`、`facebook.svg`、`instagram.svg`。仅保留路径并调整显示尺寸与主题颜色，不引入上游运行时或依赖包。
- Simple Icons 的图标路径采用 [CC0 1.0 Universal](https://github.com/simple-icons/simple-icons/blob/13.21.0/LICENSE.md)。Google 的四色 G 与 Microsoft 的四色方块以本地 SVG 绘制，分别参照 [Google 品牌标识说明](https://developers.google.com/identity/branding-guidelines) 与 [Microsoft 商标说明](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks)。品牌名称与标识属于各自所有者，仅用于标明分类对应的平台。
