/* ==========================================================================
   LocalOTP · theme-boot
   在样式表生效前用同步的 localStorage 定下主题，避免深色用户看到一帧白闪。
   chrome.storage 是异步的，所以主题在这里镜像一份。
   ========================================================================== */

(function () {
  "use strict";

  const VALID_SCHEMES = ["ocean", "aurora", "sunset", "midnight", "nebula", "ember"];
  const LEGACY_MAP = { blue: "ocean", green: "ocean", purple: "aurora", pink: "sunset", mono: "ocean" };
  let pref = "light";
  let colorScheme = "ocean";
  try {
    pref = localStorage.getItem("localotp:theme-preference") || localStorage.getItem("localotp:theme") || "light";
    const savedColor = localStorage.getItem("localotp:color-scheme");
    if (VALID_SCHEMES.includes(savedColor)) colorScheme = savedColor;
    else if (savedColor && LEGACY_MAP[savedColor]) colorScheme = LEGACY_MAP[savedColor];
  } catch (err) {
    /* 隐私模式等场景下取不到，按 auto 处理 */
  }

  let theme = pref;
  if (theme !== "light" && theme !== "dark") {
    theme =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.colorScheme = colorScheme;
})();
