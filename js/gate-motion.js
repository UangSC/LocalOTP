/* 门禁形变：壳体走完整路径，真实内容同步裁切；收尾不重播 CSS 入场。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  const ease = "cubic-bezier(.65,0,.2,1)";
  async function transition({ app, lock, entering }) {
    const card = lock.querySelector(".lock-card");
    const page = document.body.dataset.surface === "page";
    if (OTP.reduceMotion() || !card.animate || document.hidden) {
      document.body.dataset.locked = entering ? "" : "1";
      return;
    }
    const animations = [];
    const preparedAnimations = [];
    const parent = lock.parentNode;
    const stage = app.parentElement;
    const duration = (page ? 680 : 420) * Math.max(1, Number(global.__animSpeed) || 1);
    let panel, preparation, timeout, finishEarly, releasePrepared, wasInterrupted = false;
    const animate = (node, frames, options = {}) => {
      const animation = node.animate(frames, { duration, easing: ease, fill: "both", ...options });
      animations.push(animation);
      if (page && entering) {
        animation.pause();
        animation.currentTime = node === card ? 0 : animation.effect.getComputedTiming().endTime;
        preparedAnimations.push(animation);
      }
      return animation;
    };
    const interrupted = new Promise((resolve) => { finishEarly = resolve; });
    const interrupt = () => { wasInterrupted = true; finishEarly(); };
    const onHidden = () => { if (document.hidden) interrupt(); };
    const onResize = interrupt;
    try {
      document.addEventListener("visibilitychange", onHidden);
      global.addEventListener("resize", onResize);
      document.body.dataset.gateMotion = entering ? "opening" : "closing";
      card.style.animation = "none";
      lock.style.transition = "none";
      lock.style.opacity = "1";
      if (page) {
        const pageRect = app.getBoundingClientRect();
        // 用原布局的卡片终点坐标，不改变锁屏父节点时的几何尺寸。
        const cardRect = card.getBoundingClientRect();
        lock.style.cssText += `;position:fixed;left:${pageRect.left}px;top:${pageRect.top}px;width:${pageRect.width}px;height:${pageRect.height}px;inset:auto;z-index:104;`;
        lock.style.left = pageRect.left + "px";
        lock.style.top = pageRect.top + "px";
        document.body.append(lock);
        stage.style.zIndex = "101";
        if (entering) {
          // 预绘制真实内容，不牺牲后续的完整形变。0.99 让浏览器提交底层光栅，
          // 准备期间保持登录卡可见，既不提前露出整页，也不在运动途中首次排版。
          preparation = OTP.el("div", { class: "gate-preparation", "aria-hidden": "true" });
          preparation.style.cssText = `position:fixed;inset:0;z-index:103;pointer-events:none;opacity:.99;background:${getComputedStyle(document.body).background}`;
          document.body.append(preparation);
          app.style.willChange = "clip-path, opacity";
          document.body.dataset.locked = "";
          releasePrepared = OTP.list.prepareMotion();

        }
        const small = `translate(${cardRect.left - pageRect.left}px,${cardRect.top - pageRect.top}px) scale(${cardRect.width / pageRect.width},${cardRect.height / pageRect.height})`;
        panel = OTP.el("div", { class: "flip-panel", "aria-hidden": "true" });
        panel.style.cssText = `position:fixed;left:${pageRect.left}px;top:${pageRect.top}px;width:${pageRect.width}px;height:${pageRect.height}px;z-index:100;pointer-events:none;transform-origin:0 0;background:var(--surface);box-shadow:var(--shadow-l);border:1px solid var(--line-soft);will-change:transform;`;
        document.body.append(panel);
        const radius = parseFloat(getComputedStyle(card).borderRadius) || 22;
        const fullRadius = parseFloat(getComputedStyle(app).borderRadius) || 0;
        const smallRadius = `${radius * pageRect.width / cardRect.width}px / ${radius * pageRect.height / cardRect.height}px`;
        const smallClip = `inset(${cardRect.top - pageRect.top}px ${pageRect.right - cardRect.right}px ${pageRect.bottom - cardRect.bottom}px ${cardRect.left - pageRect.left}px round ${radius}px)`;
        const largeClip = `inset(0px 0px 0px 0px round ${fullRadius}px)`;
        // 背景壳与内容用相同缓动，壳体不会提前消失。
        animate(panel, entering ? [
          { transform: small, borderRadius: smallRadius },
          { transform: "none", borderRadius: fullRadius + "px" },
        ] : [
          { transform: "none", borderRadius: fullRadius + "px" },
          { transform: small, borderRadius: smallRadius },
        ]);
        stage.style.zIndex = "101";
        app.style.boxShadow = "none";
        app.style.transformOrigin = "top left";
        app.style.willChange = "clip-path, opacity";
        animate(app, [{ clipPath: entering ? smallClip : largeClip }, { clipPath: entering ? largeClip : smallClip }]);
        animate(app, entering ? [
          { opacity: .001 }, { opacity: .001, offset: .22 }, { opacity: 1, offset: .84 }, { opacity: 1 },
        ] : [
          { opacity: 1 }, { opacity: 1, offset: .12 }, { opacity: 0, offset: .65 }, { opacity: 0 },
        ], { easing: "linear" });
        document.body.dataset.locked = "";
        if (entering) {
          for (const [selector, x, y] of [[".sidebar", -20, 0], [".main-head", 0, -14], [".statusbar", 0, 10]]) {
            const node = app.querySelector(selector);
            if (node) animate(node, [{ opacity: 0, transform: `translate(${x}px,${y}px)` }, { opacity: 1, transform: "none" }],
              { delay: duration * .35, duration: duration * .65, easing: "cubic-bezier(.16,1,.3,1)" });
          }
          const rows = OTP.list.reveal({ delay: duration * .34, step: 27, duration: 470 }) || [];
          for (const animation of rows) {
            animation.pause();
            animation.currentTime = animation.effect.getComputedTiming().endTime;
            preparedAnimations.push(animation);
          }
        }
      } else {
        if (entering) OTP.list.reveal({ delay: 90, step: 25, duration: 420 });
      }
      animate(page ? card : lock, entering ? [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(-10px) scale(.96)", offset: .25 },
        { opacity: 0, transform: "translateY(-10px) scale(.96)" },
      ] : [
        { opacity: 0, transform: "translateY(12px) scale(.94)" },
        { opacity: 0, transform: "translateY(12px) scale(.94)", offset: .62 },
        { opacity: 1, transform: "none" },
      ], { easing: "linear" });
      if (preparedAnimations.length) {
        document.body.dataset.gatePhase = "preparing";
        await Promise.all(preparedAnimations.map(a => a.ready.catch(() => {})));
        await new Promise(resolve => {
          const start = performance.now();
          let previous = start, stable = 0, frame;
          const end = () => { clearTimeout(limit); cancelAnimationFrame(frame); resolve(); };
          const limit = setTimeout(end, 600);
          const sample = (now) => {
            stable = now - previous < 24 ? stable + 1 : 0;
            previous = now;
            if (now - start >= 120 && stable >= 4) end();
            else frame = requestAnimationFrame(sample);
          };
          frame = requestAnimationFrame(sample);
        });
        if (wasInterrupted || document.hidden) return;
        preparedAnimations.forEach(a => { a.currentTime = 0; a.play(); });
        preparation?.remove();
      }
      document.body.dataset.gatePhase = "moving";
      await Promise.race([
        Promise.all(animations.map((a) => a.finished.catch(() => {}))),
        interrupted,
        new Promise((resolve) => { timeout = setTimeout(resolve, duration + 180); }),
      ]);
    } finally {
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onHidden);
      global.removeEventListener("resize", onResize);
      document.body.dataset.locked = entering ? "" : "1";
      if (entering) lock.style.visibility = "hidden";
      // 先提交静态终态，再撤销动画；绝不恢复 lock-card 的入场 animation。
      card.style.animation = "none";
      animations.forEach((a) => a.cancel());
      panel?.remove();
      preparation?.remove();
      stage.style.zIndex = "";
      app.style.boxShadow = "";
      app.style.transformOrigin = "";
      app.style.willChange = "";
      if (!entering && parent.isConnected) {
        lock.style.cssText = "opacity:1;transition:none";
        parent.append(lock);
      }
      releasePrepared?.();
      if (wasInterrupted) OTP.list.cancelMotion();
      delete document.body.dataset.gateMotion;
      delete document.body.dataset.gatePhase;
    }
  }
  OTP.gateMotion = { transition };
})(window);
