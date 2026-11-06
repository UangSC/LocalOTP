/* tooltips 通用界面控件。 */
(function (global) {
  "use strict";
  global.OTP.createTooltips = function ({ refs } = {}) {
    const OTP = global.OTP;
    const { clamp } = OTP;
    function hostOf(event) {
      return event.target instanceof Element ? event.target.closest("[data-tip]") : null;
    }

    function bindTooltips() {
      document.addEventListener("pointerover", (e) => {
        const host = hostOf(e);
        if (!host || host === refs.tipTarget) return;
        refs.tipTarget = host;
        clearTimeout(refs.tipTimer);
        refs.tipTimer = setTimeout(() => showTip(host), 320);
      });

      document.addEventListener("pointerout", (e) => {
        const host = hostOf(e);
        if (!host || host !== refs.tipTarget) return;
        if (e.relatedTarget instanceof Node && host.contains(e.relatedTarget)) return;
        clearTimeout(refs.tipTimer);
        refs.tipTarget = null;
        hideTip();
      });

      document.addEventListener("focusin", (e) => {
        const host = hostOf(e);
        if (!host) return;
        refs.tipTarget = host;
        clearTimeout(refs.tipTimer);
        showTip(host);
      });

      document.addEventListener("focusout", () => {
        refs.tipTarget = null;
        clearTimeout(refs.tipTimer);
        hideTip();
      });

      document.addEventListener(
        "pointerdown",
        () => {
          refs.tipTarget = null;
          clearTimeout(refs.tipTimer);
          hideTip();
        },
        true
      );

      document.addEventListener("scroll", hideTip, true);
    }

    function showTip(host) {
      if (!refs.tip || !host || !host.isConnected) return;
      const text = host.getAttribute("data-tip");
      if (!text) return;

      refs.tip.textContent = text;
      refs.tip.classList.add("is-on");

      const box = refs.app.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const tipRect = refs.tip.getBoundingClientRect();
      const gap = 7;

      let top = hostRect.top - box.top - tipRect.height - gap;
      if (top < 4) top = hostRect.bottom - box.top + gap;
      if (top + tipRect.height > box.height - 4) {
        top = Math.max(4, hostRect.top - box.top - tipRect.height - gap);
      }

      const alignEnd = host.getAttribute("data-tip-align") === "end";
      let left = alignEnd
        ? hostRect.right - box.left - tipRect.width
        : hostRect.left - box.left + hostRect.width / 2 - tipRect.width / 2;

      left = clamp(left, 6, Math.max(6, box.width - tipRect.width - 6));
      top = clamp(top, 4, Math.max(4, box.height - tipRect.height - 4));

      refs.tip.style.left = Math.round(left) + "px";
      refs.tip.style.top = Math.round(top) + "px";
    }

    function hideTip() {
      if (refs.tip) refs.tip.classList.remove("is-on");
    }

    /* ── 抽屉 ─────────────────────────────────────────────────────────────── */


    return { bindTooltips, hideTip };
  };
})(globalThis);
