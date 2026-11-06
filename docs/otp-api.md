# 本地验证码入口

LocalOTP 提供扩展内的验证码页面。安装扩展后即可使用，不需要服务器、登录、保存账号或开放端口。所有计算都由 Web Crypto 在浏览器本机完成。

## 地址栏快捷入口

1. 输入 `otp`。
2. 按 Tab 或空格，确认地址栏进入 **LocalOTP** 模式。
3. 粘贴 Base32 密钥或完整 `otpauth://totp/…` 链接，回车。

输入格式：`otp YOUR_BASE32_SECRET`，将占位符替换为待计算的 Base32 密钥；公开测试数据见 `examples/sync-test.txt`。

## 页面 URL 接口

在设置的“临时验证码与地址栏 API”中复制本机入口地址。固定公钥版本使用 README 中的固定 ID；入口地址以当前运行的扩展为准。

```text
chrome-extension://<扩展ID>/api.html#otp=YOUR_BASE32_SECRET
chrome-extension://<扩展ID>/api.html#otp=YOUR_BASE32_SECRET&algorithm=SHA256&digits=8&period=45
```

| 参数 | 含义 | 默认 / 范围 |
| --- | --- | --- |
| `otp` | Base32 密钥或 URL 编码后的 otpauth 链接 | 必填，与 `secret` / `uri` 三选一 |
| `secret`、`uri` | `otp` 的兼容别名 | 不可重复提供 |
| `algorithm` | 摘要算法 | `SHA1` / `SHA256` / `SHA512`，兼容带短横线写法 |
| `digits` | 验证码位数 | `6` 或 `8` |
| `period` | 周期，单位秒 | 默认 `30`，允许 `1–86400` 的整数 |

也支持 `?secret=…` 查询形式、`#BASE32` 简写。推荐使用 `#otp=…`：片段不会作为 HTTP 请求参数发送。不要同时使用查询参数和片段传入 OTP，也不要重复参数。

如果传入完整 otpauth 链接，使用 `encodeURIComponent(uri)` 编码后放在 `otp` 参数中，算法、位数与周期均以该链接为准，不允许在外层再次覆盖。HOTP 需要维护计数器，当前明确拒绝。

页面解析后立即替换当前历史项，移除密钥参数；重载页面需重新输入。空参数、无效 Base32、异常周期、重复参数、损坏的 URL 编码会显示错误并禁用复制，不会猜测修补或静默换算法。

## 使用与隐私

- 弹窗解锁后，搜索框下方的“临时验证码”接受相同输入；独立页面还提供高级参数。
- 默认隐藏密钥；可以显示、清除，或按 Esc 清除。输入框内按 Enter 复制验证码。
- 倒计时按系统时间计算；复制时重新计算当前周期。系统时间有误时，请先校准系统时钟。
- 临时密钥不会加入账号库、localStorage、sessionStorage 或浏览器同步。账号库的现有存储方式与此独立。
- 页面隐藏时暂停调度，返回后立即重新计算；弹窗锁定、页面离开、重载后清除临时数据。
- 独立页面不载入账号库模块，不请求外部资源，CSP 禁止网络连接。
- 浏览器可能在地址栏历史、建议或浏览器账号同步中记录用户输入；替换当前历史项不能保证擦除这些副本。敏感密钥优先在页面输入框中填写。

这是浏览器内的 **URL 页面接口**，不是 HTTP / REST 服务，也不是可供 curl 或任意网站读取的公开 JSON API。扩展不会监听本机 HTTP 端口；不额外申请网站访问、浏览记录、内容脚本或 externally_connectable 权限。

## 平台

面向 Windows 与 macOS 上的 Edge / Chrome（Chromium 111+，推荐当前稳定版），共用同一份 MV3 扩展。macOS 使用 Command K，Windows 使用 Ctrl K，字体跟随系统。

已在 Windows Edge 隔离配置验收真实扩展页面和剪贴板；macOS 仅验证了平台分支与布局，未在 Mac 真机运行。Safari 需要单独转换为 Safari Web Extension，本包不宣称可直接安装到 Safari。
