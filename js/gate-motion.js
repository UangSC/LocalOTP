/* 门禁展开 / 收回：空白背景形变，真实内容同步裁切淡入，文字始终保持原始尺寸。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  let needsInitialPaint = true;
  async function transition({ app, lock, entering }) {
    const page = document.body.dataset.surface === "page", card = lock.querySelector(".lock-card");
    if (OTP.reduceMotion() || !card.animate || document.hidden) {
      document.body.dataset.locked = entering ? "" : "1";
      return;
    }
    const parent = lock.parentNode, stage = app.parentElement, animations = [];
    const duration = (page ? (entering ? 520 : 460) : 180) * Math.max(1, Number(global.__animSpeed) || 1);
    const stageZ = stage.style.zIndex, appShadow = app.style.boxShadow, appWillChange = app.style.willChange;
    let panel, preparation, timeout, paintTimeout, finishEarly, interruptedEarly = false, frame;
    const interrupted = new Promise(resolve => { finishEarly = resolve; });
    const interrupt = () => { interruptedEarly = true; finishEarly(); };
    const onHidden = () => { if (document.hidden) interrupt(); };
    const animate = (node, frames, easing = "cubic-bezier(.4,0,.2,1)") => {
      const animation = node.animate(frames, { duration, easing, fill: "both" });
      animation.pause(); animation.currentTime = 0;
      animations.push(animation);
    };
    try {
      document.addEventListener("visibilitychange", onHidden);
      global.addEventListener("resize", interrupt);
      document.body.dataset.gateMotion = entering ? "opening" : "closing";
      document.body.dataset.gatePhase = "preparing";
      card.style.animation = "none"; lock.style.transition = "none";
      if (page) {
        const full = app.getBoundingClientRect(), bounds = card.getBoundingClientRect();
        lock.style.cssText += `;position:fixed;left:${full.left}px;top:${full.top}px;width:${full.width}px;height:${full.height}px;inset:auto;z-index:104;opacity:1;`;
        document.body.append(lock);
        panel = OTP.el("div", { class: "flip-panel", "aria-hidden": "true" });
        panel.style.cssText = `position:fixed;left:${full.left}px;top:${full.top}px;width:${full.width}px;height:${full.height}px;background:var(--bg);box-shadow:var(--shadow-l);z-index:100;pointer-events:none;transform-origin:0 0;will-change:transform;`;
        document.body.append(panel);
        stage.style.zIndex = "101"; app.style.boxShadow = "none";
        app.style.willChange = "clip-path, opacity";
        const radius = parseFloat(getComputedStyle(card).borderRadius) || 20;
        const fullRadius = parseFloat(getComputedStyle(app).borderRadius) || 0;
        const small = {
          transform: `translate(${bounds.left-full.left}px,${bounds.top-full.top}px) scale(${bounds.width/full.width},${bounds.height/full.height})`,
          borderRadius: `${radius*full.width/bounds.width}px / ${radius*full.height/bounds.height}px`,
        };
        const large = { transform: "none", borderRadius: fullRadius + "px" };
        const smallClip = `inset(${bounds.top-full.top}px ${full.right-bounds.right}px ${full.bottom-bounds.bottom}px ${bounds.left-full.left}px round ${radius}px)`;
        const largeClip = `inset(0px 0px 0px 0px round ${fullRadius}px)`;
        animate(panel, entering ? [small, large] : [large, small]);
        animate(app, entering ? [{ clipPath: smallClip }, { clipPath: largeClip }] : [{ clipPath: largeClip }, { clipPath: smallClip }]);
        animate(app, entering
          ? [{ opacity: .001 }, { opacity: .001, offset: .18 }, { opacity: 1, offset: .88 }, { opacity: 1 }]
          : [{ opacity: 1 }, { opacity: 0, offset: .55 }, { opacity: 0 }], "linear");
        animate(card, entering
          ? [{ opacity: 1 }, { opacity: 0, offset: .25 }, { opacity: 0 }]
          : [{ opacity: 0 }, { opacity: 0, offset: .6 }, { opacity: 1 }], "linear");
        if (entering) {
          // 先绘制完整账号区，避免裁切展开时才逐块栅格化。极近不透明的遮罩
          // 保持登录卡画面，同时让浏览器提交下面的纹理，不复制账号 DOM。
          preparation = OTP.el("div", { class: "gate-preparation", "aria-hidden": "true" });
          preparation.style.cssText = "position:fixed;inset:0;z-index:103;pointer-events:none;opacity:.99";
          preparation.style.background = getComputedStyle(document.body).background;
          document.body.append(preparation);
          animations.filter(a => a.effect.target !== card).forEach(a => { a.currentTime = duration; });
        }
        // 同一帧恢复骨架，初始动画样式负责遮挡；不在运动中途突然显示整页。
        document.body.dataset.locked = "";
      } else {
        animate(lock, entering ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], "ease-out");
      }
      const ready = Promise.all(animations.map(a => a.ready.catch(() => {})));
      await Promise.race([ready, interrupted]);
      if (page && entering && !interruptedEarly) {
        // 首次绘制在登录卡后完成；后续往返只提交两帧，避免每次额外等待。
        await Promise.race([new Promise(resolve => {
          if (!needsInitialPaint) {
            frame = requestAnimationFrame(() => { frame = requestAnimationFrame(resolve); });
            return;
          }
          const start = performance.now();
          let previous = start, stable = 0;
          const done = () => { clearTimeout(paintTimeout); cancelAnimationFrame(frame); resolve(); };
          paintTimeout = setTimeout(done, 650);
          const sample = now => {
            stable = now-previous < 24 ? stable+1 : 0; previous = now;
            if (now-start >= 120 && stable >= 4) done();
            else frame = requestAnimationFrame(sample);
          };
          frame = requestAnimationFrame(sample);
        }), interrupted]);
        if (!interruptedEarly) needsInitialPaint = false;
      }
      if (interruptedEarly) return;
      animations.forEach(a => { a.currentTime = 0; });
      preparation?.remove();
      document.body.dataset.gatePhase = "moving";
      animations.forEach(a => a.play());
      await Promise.race([
        Promise.all(animations.map(a => a.finished.catch(() => {}))), interrupted,
        new Promise(resolve => { timeout = setTimeout(resolve, duration + 100); }),
      ]);
    } finally {
      clearTimeout(timeout);
      clearTimeout(paintTimeout);
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onHidden);
      global.removeEventListener("resize", interrupt);
      document.body.dataset.locked = entering ? "" : "1";
      if (entering) lock.style.visibility = "hidden";
      animations.forEach(a => a.cancel()); panel?.remove(); preparation?.remove(); card.style.animation = "none";
      stage.style.zIndex = stageZ; app.style.boxShadow = appShadow; app.style.willChange = appWillChange;
      if (!entering && parent.isConnected) { lock.style.cssText = "opacity:1;transition:none"; parent.append(lock); }
      delete document.body.dataset.gateMotion; delete document.body.dataset.gatePhase;
    }
  }
  OTP.gateMotion = { transition };
})(window);
