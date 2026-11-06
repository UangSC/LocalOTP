/* ticker 列表模块。 */
(function (global) {
  "use strict";
  global.OTP.createListTicker = function ({ st } = {}) {
    const OTP = global.OTP;
    const totp = OTP.totp;
    function scheduleTick() {
      clearTimeout(st.rafId);
      if (!st.running || document.hidden) return;
      st.rafId = setTimeout(frame, 1000 - Date.now() % 1000 + 8);
    }

    function startTicker() {
      st.running = true;
      if (!st.rafId) scheduleTick();
    }

    function stopTicker() {
      st.running = false;
      clearTimeout(st.rafId);
      st.rafId = 0;
    }

    /**
     * 用同一个时间戳喂所有环：
     * · 弧长 = 显示的那个整数秒 / 周期 —— 数字和弧永远对得上，不可能各走各的；
     * · 每秒只写一次 DOM，中间靠 CSS 的 1s linear 过渡补间，所以又平滑又省；
     * · 跨周期时 snap 一下（瞬切回满格），不会反向扫一圈。
     */
    function tickRings(t) {
      const now = t || Date.now();
      for (const ref of st.refs.values()) {
        const cycle = OTP.totp.cycle(ref.acc.period, now);
        const seconds = Math.max(0, Math.ceil(cycle.remaining));

        if (seconds !== ref.shownSeconds) {
          const snap = !ref.placed ? true : cycle.counter !== ref.counter;
          ref.shownSeconds = seconds;
          ref.placed = true;
          ref.ring.paint({
            seconds,
            period: ref.acc.period,
            state: seconds <= 4 ? "hot" : seconds <= 10 ? "warn" : "calm",
            snap,
          });
        }
      }
    }

    function frame() {
      st.rafId = 0;
      if (!st.running || document.hidden) return;
      const time = Date.now();
      tickRings(time);
      for (const ref of st.refs.values()) {
        const cycle = OTP.totp.cycle(ref.acc.period, time);
        if (cycle.counter !== ref.counter) {
          ref.counter = cycle.counter;
          updateCode(ref);
        }
      }
      scheduleTick();
    }

    function updateCode(ref) {
      if (ref.pending) return ref.pending;
      if (!ref.node.isConnected) return Promise.resolve();
      ref.pending = OTP.totp.generate(ref.acc).then((result) => {
        if (!ref.node.isConnected) return;
        const changed = ref.code && ref.code !== result.code;
        ref.code = result.code;
        ref.codeNode.textContent = OTP.fmt.group(result.code);
        ref.codeNode.classList.remove("is-loading");
        if (changed) OTP.flash(ref.codeNode, "is-new", 420);
      }).catch(() => {
        ref.codeNode.textContent = "—— ——";
        ref.codeNode.classList.add("is-loading");
      }).finally(() => { ref.pending = null; });
      return ref.pending;
    }

    function refreshAll(force = true) {
      const jobs = [];
      // 同一戳、一次性把环放到当前进度（snap，不做补间）：
      // 既不会首帧"扫"一遍，也不会有逐行 Date.now() 造成的毫秒漂移。
      const t = Date.now();
      for (const ref of st.refs.values()) {
        const cycle = OTP.totp.cycle(ref.acc.period, t);
        const seconds = Math.max(0, Math.ceil(cycle.remaining));
        const needsCode = force || cycle.counter !== ref.counter;
        ref.counter = cycle.counter;
        ref.shownSeconds = seconds;
        ref.placed = true;
        ref.ring.paint({
          seconds,
          period: ref.acc.period,
          state: seconds <= 4 ? "hot" : seconds <= 10 ? "warn" : "calm",
          snap: true,
        });
        if (needsCode) jobs.push(updateCode(ref));
      }
      return Promise.all(jobs);
    }

    /** 复制前强制重算：别把周期边界上刚好过期的码写进剪贴板 */
    async function codeFor(account) {
      return OTP.totp.generate(account);
    }

    function codeMap() {
      const map = new Map();
      for (const [id, ref] of st.refs) if (ref.code) map.set(id, ref.code);
      return map;
    }

    /* ── 搜索聚光 ─────────────────────────────────────────────────────────── */

    /**
     * 不隐藏任何条目：命中项提亮 + 左侧品牌色光条，其余压低对比。
     * 保留空间关系，用户仍然知道"命中的那条在整列的哪儿"。
     */

    return { scheduleTick, startTicker, stopTicker, refreshAll, codeFor, codeMap };
  };
})(globalThis);
