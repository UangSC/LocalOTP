# 测试与验证

`npm test` 是统一入口，按顺序运行核心逻辑、门禁和真实浏览器用例，遇到失败立即退出。测试使用隔离浏览器配置，不读取日常个人资料。需要可启动的 Edge / Chromium；可在 `tools/cdp.mjs` 的候选路径中添加本机浏览器。

| 检查 | 覆盖 |
| --- | --- |
| `check-project.mjs` | 版本、公钥、资源、文档与常见凭据模式；`--history` 追加已有历史文本扫描 |
| `selftest.mjs` | RFC 标准向量、Base32、导入、备份、检索和密码摘要 |
| `sync-test.mjs` | 合并、冲突、字段重排、删除传播、配额、错误恢复、多页面持久化 |
| `access-test.mjs`、`access-client-test.mjs` | 调用者、proof、票据过期/重放、会话撤销、错误传播 |
| `otp-core-test.mjs` | 临时验证码输入、时钟边界、异步计算和取消 |
| `extension-test.mjs`、`sync-isolation-test.mjs` | 真实后台缓存、重复合并、两个同 ID 配置之间的隔离 |
| `management-page-test.mjs` | 新管理页接续授权、复用、跨窗口聚焦、并发打开、锁屏边界 |
| `popup-context-test.mjs` | 真正工具栏弹窗缺少 documentId 的消息路径及授权拒绝 |
| `window-browser-test.mjs` | 常驻、画中画、短时免密与诊断界面 |
| `otp-browser-test.mjs` | 临时验证码页面、URL 清理和浏览器交互 |
| `qa.mjs` | 新增、编辑、删除、导入、搜索、设置、主题、门禁与管理页 |

样式相关变更再运行 `color-test.mjs`、`avatar-test.mjs`、`select-test.mjs`；动画或大量数据相关变更再运行 `regression.mjs`、`perf.mjs`。性能测试单独执行。截图输出到 `artifacts/`，不提交生成物；必要时通过 `shots.mjs` 生成视觉检查材料。

## 0.9.0 的验证重点

- 模块拆分保持原来的数据格式、DOM 结构及加载顺序。
- 不开启短时免密也能从已解锁弹窗进入新管理页；已存在的管理页不重载，已锁定页面不被跳过。
- 真实存储往返后的字段重排不会造成无修改的重复读取/写入。
- 新演示账号、密码、密钥和导入文件都是此次生成的公开测试夹具。
- 配置不新增站点、tabs 或管理其他扩展的权限，固定扩展 ID 不变。

## 云端传输边界

隔离用例显式关闭云同步或没有登录账号，只能验证缓存与本地行为。内存模拟的数据传递不是微软或 Google 同步服务验收。

用户反馈旧 ID 迁移后 Windows / macOS Edge 已能收到账号。进一步验收应只在 A 导入带唯一标记的测试记录，确认 B 自动出现；随后由 B 修改备注、由 A 确认，再测试删除与离线重连。两个设备各自导入相同数据不构成云端同步证据。
