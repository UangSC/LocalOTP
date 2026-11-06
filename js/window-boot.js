/* 窗口间一次性授权票据只在内存中使用，立即移除地址栏片段。 */
(function () {
  "use strict";
  const url = new URL(location.href);
  const ticket = new URLSearchParams(url.hash.slice(1)).get("unlock");
  if (ticket) { globalThis.localOtpWindowTicket = ticket; history.replaceState(null, "", url.pathname + url.search); }
  const floating = url.searchParams.get("floating");
  if (floating === "1" || floating === "pip") document.documentElement.dataset.floating = floating;
})();
