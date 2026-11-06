/* motion 列表模块。 */
(function (global) {
  "use strict";
  global.OTP.createListMotion = function ({ st } = {}) {
    const OTP = global.OTP;
    const { el, clear, clamp } = OTP;
    const motionAnimations = new Set();
    const motionLayers = new Set();
    function trackMotion(node, frames, options) {
      const animation = node.animate(frames, { fill: "both", ...options });
      motionAnimations.add(animation);
      node.dataset.motion = "active";
      animation.finished.catch(() => {}).finally(() => {
        motionAnimations.delete(animation);
        animation.cancel();
        if (!node.getAnimations().some(a => motionAnimations.has(a))) delete node.dataset.motion;
      });
      return animation;
    }
    function cancelMotion() {
      for (const animation of motionAnimations) animation.cancel();
      motionAnimations.clear();
      for (const layer of motionLayers) layer.remove();
      motionLayers.clear();
      st.refs.forEach(ref => delete ref.node.dataset.motion);
    }
    function visibleItems() {
      const viewport = st.viewport.getBoundingClientRect();
      return [...st.refs.values()].map(ref => ({ ref, rect: ref.node.getBoundingClientRect() }))
        .filter(({rect}) => rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right)
        .slice(0, 24);
    }
    function reveal(options = {}) {
      if (OTP.reduceMotion() || document.hidden || !st.container.animate) return;
      cancelMotion();
      const items = visibleItems();
      return items.map(({ref}, index) => {
        return trackMotion(ref.node, [
          { opacity: 0 },
          { opacity: 1 },
        ], { duration: options.duration || 220, delay: (options.delay || 0) + Math.min(index, 12) * (options.step || 16), easing: "cubic-bezier(.16,1,.3,1)" });
      });
    }
    function prepareMotion() { return () => {}; }
    function transitionLayout(commit) {
      cancelMotion();
      if (OTP.reduceMotion() || document.hidden || !st.container.animate) { commit(); return; }
      const before = visibleItems();
      const viewport = st.viewport.getBoundingClientRect();
      const layer = el("div", { class: "layout-ghost", "aria-hidden": "true", inert: true });
      // 只复制可见项作为 180ms 离场快照，不复制输入框或全量账号库。
      for (const {ref, rect} of before) {
        const ghost = ref.node.cloneNode(true);
        ghost.removeAttribute("tabindex");
        ghost.removeAttribute("data-motion");
        ghost.style.cssText += `;position:absolute;left:${rect.left-viewport.left}px;top:${rect.top-viewport.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;animation:none;`;
        layer.append(ghost);
      }
      st.viewport.append(layer);
      motionLayers.add(layer);
      commit();
      const outgoing = trackMotion(layer, [{opacity: .8}, {opacity:0}],
        {duration:120, easing:"cubic-bezier(.4,0,1,1)"});
      outgoing.finished.catch(() => {}).finally(() => { layer.remove(); motionLayers.delete(layer); });
      visibleItems().forEach(({ref, rect}, index) => {
        trackMotion(ref.node, [
          {opacity:0},
          {opacity:1},
        ], {duration:240, delay:35 + Math.min(index,8)*14, easing:"cubic-bezier(.16,1,.3,1)"});
      });
    }

    /* ── 行 ───────────────────────────────────────────────────────────────── */


    return { cancelMotion, reveal, prepareMotion, transitionLayout };
  };
})(globalThis);
