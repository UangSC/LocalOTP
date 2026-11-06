/* 一个临时密钥的生命周期。时钟和调度可注入，测试直接覆盖跨周期及异步竞态。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  OTP.createOtpSession = function ({ onState, now = Date.now, generate = OTP.totp.generate,
    schedule = setTimeout, cancel = clearTimeout } = {}) {
    let account = null, label = "", revision = 0, timer = 0, paused = false, disposed = false;
    let value = { status: "empty", code: "", remaining: 0 };
    const emit = next => { value = next; onState?.({ ...next }); };
    const clearTimer = () => { cancel(timer); timer = 0; };
    const active = rev => !disposed && !paused && account && revision === rev;
    const fail = message => emit({ status: "error", code: "", remaining: 0, error: message });
    function plan(rev) {
      clearTimer();
      if (active(rev)) timer = schedule(() => { timer = 0; refresh(rev); }, 1000 - now() % 1000 + 4);
    }
    async function calculate(rev) {
      // 计算跨过边界时丢弃旧周期；不允许旧输入覆盖新输入，也不复制过期码。
      for (let attempt = 0; attempt < 3 && active(rev); attempt++) {
        const at = now();
        const result = await generate(account, at);
        if (!active(rev)) return null;
        const cycle = OTP.totp.cycle(account.period, now());
        if (result.counter === cycle.counter) return { result, cycle };
      }
      if (active(rev)) throw new Error("系统时间变化过快，请稍后重试");
      return null;
    }
    function ready(result, cycle) {
      emit({ status: "ready", code: result.code, counter: cycle.counter,
        remaining: Math.ceil(cycle.remaining), period: account.period, digits: account.digits,
        algorithm: account.algorithm, label });
    }
    async function refresh(rev = revision) {
      if (!active(rev)) return;
      try {
        const cycle = OTP.totp.cycle(account.period, now());
        if (value.status === "ready" && value.counter === cycle.counter) {
          ready({ code: value.code }, cycle);
        } else {
          emit({ status: "pending", code: "", remaining: 0 });
          const fresh = await calculate(rev);
          if (fresh && active(rev)) ready(fresh.result, fresh.cycle);
        }
      } catch (_) {
        if (active(rev)) fail(OTP.totp.hasSubtle() ? "验证码计算失败，请检查系统时间后重新输入" : "浏览器不支持 Web Crypto，请使用最新版 Edge 或 Chrome");
      } finally { if (active(rev) && value.status !== "error") plan(rev); }
    }
    function setInput(raw, options = {}) {
      clearTimer();
      revision++;
      account = null;
      if (disposed) return;
      const parsed = OTP.otpInput.parse(raw, options);
      if (parsed.error) { fail(parsed.error); return; }
      if (parsed.empty) { emit({ status: "empty", code: "", remaining: 0 }); return; }
      account = parsed.account;
      label = parsed.label;
      emit({ status: paused ? "paused" : "pending", code: "", remaining: 0 });
      if (!paused) refresh(revision);
    }
    async function copy(write) {
      const rev = revision;
      if (!active(rev)) return false;
      try {
        const fresh = await calculate(rev);
        if (!fresh || !active(rev)) return false;
        ready(fresh.result, fresh.cycle);
        // write 在当前调用栈中启动，计算结束后再次检查的周期即是要复制的周期。
        const ok = await write(fresh.result.code);
        return !!ok && active(rev);
      } catch (_) { return false; }
    }
    function pause() {
      paused = true; revision++; clearTimer();
      if (account) emit({ status: "paused", code: "", remaining: 0 });
    }
    function resume() {
      if (disposed || !paused) return;
      paused = false;
      if (account) refresh(revision);
    }
    return { setInput, copy, pause, resume, snapshot: () => ({ ...value }),
      clear: () => setInput(""),
      destroy() { clearTimer(); revision++; disposed = true; account = null; label = ""; value = { status: "empty", code: "", remaining: 0 }; } };
  };
})(globalThis);
