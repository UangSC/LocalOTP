/* 浏览器地址栏入口。仅在用户回车后打开本地页面，不回显密钥到建议列表。 */
(function () {
  "use strict";
  if (!globalThis.chrome?.omnibox) return;
  const description = "本机计算临时验证码 · 粘贴 Base32 密钥或 otpauth 链接后回车";
  chrome.omnibox.setDefaultSuggestion({ description });
  chrome.omnibox.onInputChanged.addListener((_text, suggest) => suggest([]));
  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    const raw = text.length <= OTP.otpInput.MAX_INPUT ? text : "输入过长";
    const url = OTP.otpInput.entryUrl(chrome.runtime.getURL("api.html"), raw);
    // 不请求 tabs 或站点权限：创建页面与更新当前标签 URL 不需要读取浏览记录。
    const done = () => { void chrome.runtime.lastError; };
    if (disposition === "currentTab") chrome.tabs.update({ url }, done);
    else chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" }, done);
  });
})();
