(function () {
  "use strict";
  const OTP = globalThis.OTP;
  OTP.ui.mount(document.getElementById("api-app"));
  const widget = OTP.mountOtpWidget(document.getElementById("api-generator"), { expanded: true });
  function accept(href) {
    const entry = OTP.otpInput.readLocation(href);
    if (entry.error) widget.showError(entry.error);
    else widget.setInput(entry.raw, entry.options);
  }
  const entry = globalThis.localOtpEntry || location.href;
  delete globalThis.localOtpEntry;
  accept(entry);
  addEventListener("hashchange", () => {
    const href = location.href;
    history.replaceState(null, "", location.pathname);
    accept(href);
  });
  const themeButton = document.getElementById("api-theme");
  const media = matchMedia("(prefers-color-scheme: dark)");
  let override = null;
  function theme() {
    const validSchemes = ["ocean", "aurora", "sunset", "midnight", "nebula", "ember"];
    const legacyMap = { blue: "ocean", green: "ocean", purple: "aurora", pink: "sunset", mono: "ocean" };
    let pref = "light", scheme = "ocean";
    try { pref = localStorage.getItem("localotp:theme-preference") || localStorage.getItem("localotp:theme") || "light";
      scheme = localStorage.getItem("localotp:color-scheme") || "ocean"; } catch (_) {}
    if (!validSchemes.includes(scheme)) scheme = legacyMap[scheme] || "ocean";
    const next = override || (["dark", "light"].includes(pref) ? pref : media.matches ? "dark" : "light");
    document.documentElement.dataset.theme = next;
    document.documentElement.dataset.colorScheme = scheme;
    themeButton.innerHTML = OTP.icon(next === "dark" ? "sun" : "moon", 18);
    themeButton.setAttribute("aria-label", next === "dark" ? "切换浅色主题" : "切换深色主题");
  }
  const brandLink = document.querySelector(".api-brand");
  if (brandLink && !["chrome-extension:", "edge-extension:", "moz-extension:"].includes(location.protocol) && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    brandLink.href = "https://github.com/UangSC/LocalOTP";
    brandLink.target = "_blank";
    brandLink.rel = "noopener noreferrer";
    brandLink.setAttribute("aria-label", "访问 LocalOTP GitHub 仓库");
  }
  themeButton.addEventListener("click", () => { override = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; theme(); });
  media.addEventListener("change", theme);
  addEventListener("storage", event => { if (event.key?.startsWith("localotp:theme") || event.key === "localotp:color-scheme") { override = null; theme(); } });
  theme();
  document.getElementById("api-local-icon").innerHTML = OTP.icon("lock", 14);
  const entryButton = document.getElementById("api-copy-entry");
  entryButton.addEventListener("click", async () => {
    const ok = await OTP.copyText(new URL("api.html", location.href).href + "#otp=");
    OTP.ui.toast(ok ? "已复制入口地址，末尾追加 OTP 密钥即可" : "复制失败，请手动复制地址栏", ok ? "ok" : "bad");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") OTP.ui.closeSelect();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); widget.focus(); }
  });
})();
