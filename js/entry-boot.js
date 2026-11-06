/* 先取走参数并替换当前历史项，再加载页面资源。片段不会发送到服务器。 */
(function () {
  "use strict";
  globalThis.localOtpEntry = location.href;
  if (location.search || location.hash) {
    try { history.replaceState(null, "", location.pathname); }
    catch (_) { /* 部分预览环境禁止修改历史，仍保持本地计算 */ }
  }
})();
