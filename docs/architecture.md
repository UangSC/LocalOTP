# 维护说明

项目使用原生 JavaScript、Web Crypto 和 Manifest V3，无构建器或运行依赖。页面按 HTML 中的 `<script>` 顺序加载；模块挂在 `OTP` 命名空间下。不要在页面里另外维护账号副本或绕过存储接口。

## 入口与加载顺序

- `popup.html`：工具栏和常驻小窗；`index.html`：管理页；二者共享账号及表单模块。
- `api.html`：临时验证码，不加载账号 store 或管理页门禁。
- `js/background.js`：Service Worker，同步调度及打开页面；通过 `importScripts` 加载纯数据模块。
- 基础工具 / TOTP → store 子模块 → `store.js` → UI 子模块 → `ui.js` → list 子模块 → `list.js` → sheets 子模块 → `sheets.js` → app 子模块 → `app.js`。
- 子模块定义工厂函数；入口传入必要状态或回调。共享状态仍由入口持有，避免模块之间相互复制状态。

新增页面模块时更新对应 HTML 的显式脚本顺序；新增纯数据模块时同时检查后台与 VM 测试加载顺序。`npm run check` 会检查资源存在性、重复脚本、语法及文档链接；它不能代替行为测试。

## 变更应放在哪里

| 需求 | 位置 |
| --- | --- |
| 账号、分类增删改和持久化 | `js/store.js` |
| 导入格式、重复策略、JSON 备份解析 | `js/store/import.js` |
| 管理密码摘要 | `js/store/security.js` |
| 搜索、排序、命中区间 | `js/store/search.js` |
| 合并、删除传播、配额和反馈 | `js/sync.js` |
| proof、一次性票据、免密有效期 | `js/access-service.js`，客户端 `js/access.js` |
| 页面锁屏、解锁动画接入 | `js/app/gate.js` |
| 管理页打开、备份文件交互 | `js/app/navigation.js` 与后台页面打开逻辑 |
| 列表模板 / 倒计时 / 动画 | `js/list/items.js` / `ticker.js` / `motion.js` |
| 账号编辑、快速添加、导入、分类、密码表单 | `js/sheets/` 各同名模块 |
| 设置外观与访问控制 | `js/sheets/settings-appearance.js`、`settings-access.js` |
| 通用控件、提示与浮层 | `js/ui/` 和 `js/ui.js` |
| 临时验证码状态与调度 | `js/otp-input.js`、`otp-session.js`、`otp-widget.js` |

## 数据与授权边界

账号格式保持 v2，扩展发布版本 0.9.0 与数据版本是两回事。`storage.local` 保存账号、设置和管理密码摘要；`storage.sync` 用 `acc:`、`cat:`、`tomb:`、`ctomb:` 保存可合并记录；`storage.session` 保存浏览器会话授权，不保存明文管理密码。

对象字段顺序不能用于判断记录是否变化。同步采用按字段内容比较和稳定的同时间戳冲突处理。删除必须生成删除记录，不能只把数组项移除；不要随意清理墓碑，否则长期离线的设备可能把旧账号带回。

管理密码只控制界面，不加密账号库。新管理页通过已解锁源页面签发的一次性短票据接续授权；已有页面只聚焦，不刷新或强行解锁。不要把“某个标签页存在”或客户端传来的布尔值当成已授权。

## 仓库与发布

- 运行源码、可复现测试、必要使用说明保留在 Git；截图、调试输出和发布 ZIP 进入忽略目录。
- 演示数据只由 `tools/generate-demo.mjs` 生成，不从浏览器导出，不使用真实邮箱或密钥。测试需要真实登录数据时，保存在仓库外。
- `manifest.json` 与 `package.json` 的版本必须一致。公钥保持不变；新增目录后打包脚本会递归收集运行资源。
- 发布前运行 `npm test`，按修改内容追加样式或性能检查，再打包校验。发布说明应明确未验证的平台和行为。
- 从当前树移除文件不等于从 Git 历史或旧 Release 删除。若确认提交过真实凭据，先撤销/轮换，再单独安排历史清理；不要把扫描通过当成绝对安全保证。
