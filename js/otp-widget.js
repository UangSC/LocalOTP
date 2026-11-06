/* 两个入口共用的临时验证码组件；不依赖 store、账号列表或锁屏。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  const { el, icon } = OTP;
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  OTP.mountOtpWidget = function (host, { expanded = false, collapsible = false } = {}) {
    let opened = !collapsible;
    const prefix = expanded ? "api-otp" : "quick-otp";
    const input = el("input", { id: prefix + "-input", type: "password", autocomplete: "off",
      spellcheck: false, autocapitalize: "off", maxLength: OTP.otpInput.MAX_INPUT,
      placeholder: "粘贴 Base32 密钥或 otpauth:// 链接", "aria-describedby": prefix + "-hint" });
    const eye = el("button", { class: "ibtn", type: "button", "aria-label": "显示 OTP 密钥", "aria-pressed": "false", html: icon("eye", 15),
      onclick: () => { const show = input.type === "password"; input.type = show ? "text" : "password";
        eye.innerHTML = icon(show ? "eye-off" : "eye", 15); eye.setAttribute("aria-label", show ? "隐藏 OTP 密钥" : "显示 OTP 密钥");
        eye.setAttribute("aria-pressed", String(show)); input.focus(); } });
    const clear = el("button", { class: "ibtn", type: "button", "aria-label": "清除临时密钥", html: icon("x", 15), onclick: () => { reset(); input.focus(); } });
    const code = el("output", { class: "otp-value", text: "··· ···", "aria-label": "当前验证码" });
    const countdown = el("span", { class: "otp-seconds", text: "—" });
    const ring = el("div", { class: "otp-ring", "aria-hidden": "true", html:
      '<svg viewBox="0 0 40 40" fill="none"><circle class="otp-ring-track" cx="20" cy="20" r="17"/><circle class="otp-ring-fill" cx="20" cy="20" r="17" pathLength="100"/></svg>' }, countdown);
    const meter = ring.querySelector(".otp-ring-fill");
    const meta = el("span", { class: "otp-meta", text: "SHA-1 · 6 位 · 30 秒" });
    const hint = el("p", { class: "otp-hint", id: prefix + "-hint", role: "status", "aria-live": "polite", text: "仅在此处计算，关闭后清除" });
    let copying = false, feedbackTimer = 0, uiRevision = 0, disposed = false;
    const copy = el("button", { class: "btn btn-primary otp-copy", type: "button", disabled: true,
      "aria-label": "复制临时验证码", html: icon("copy", 14) + "<span>复制</span>", onclick: async () => {
        if (copying) return;
        const revision = uiRevision;
        copying = true; copy.disabled = true;
        const ok = await session.copy(OTP.copyText);
        copying = false;
        if (disposed) return;
        copy.disabled = session.snapshot().status !== "ready";
        if (revision !== uiRevision) return;
        hint.textContent = ok ? "已复制当前验证码" : "复制失败，请选中验证码手动复制";
        copy.innerHTML = icon(ok ? "check" : "copy", 14) + "<span>" + (ok ? "已复制" : "复制") + "</span>";
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => { feedbackTimer = 0; copy.innerHTML = icon("copy", 14) + "<span>复制</span>"; hint.textContent = "仅在此处计算，关闭后清除"; }, 1600);
      } });
    // 不把每秒倒计时放进 live region，以免屏幕阅读器持续打断用户。
    code.setAttribute("aria-live", "off");
    let lastCounter;
    const session = OTP.createOtpSession({ onState: state => {
      host.dataset.otpStatus = state.status;
      const ready = state.status === "ready";
      const formatted = ready ? state.code.slice(0, state.code.length / 2) + " " + state.code.slice(state.code.length / 2) : "··· ···";
      if (code.textContent !== formatted) code.textContent = formatted;
      copy.disabled = !ready || copying;
      countdown.textContent = ready ? String(state.remaining) : "—";
      ring.title = ready ? `剩余 ${state.remaining} 秒` : "等待密钥";
      ring.classList.toggle("is-expiring", ready && state.remaining <= 5);
      meter.style.transition = ready && lastCounter === state.counter ? "stroke-dashoffset 1s linear" : "none";
      meter.style.strokeDashoffset = ready ? String(100 * (1 - state.remaining / state.period)) : "100";
      lastCounter = state.counter;
      if (ready) setText(meta, `${OTP.totp.ALGO_LABEL[state.algorithm]} · ${state.digits} 位 · ${state.period} 秒`);
      else setText(meta, state.status === "pending" ? "正在计算…" : state.status === "paused" ? "已暂停，返回后更新" : "SHA-1 · 6 位 · 30 秒");
      input.setAttribute("aria-invalid", String(state.status === "error"));
      if (state.status === "error") setText(hint, state.error);
      else if (!feedbackTimer) setText(hint, "仅在此处计算，关闭后清除");
    } });
    const options = {};
    let setOptions;
    let optionControls = [];
    const advanced = el("details", { class: "otp-advanced" });
    if (expanded) {
      const algorithm = OTP.ui.select({ value: "SHA1", label: "摘要算法", items: [
        { value: "SHA1", label: "SHA-1", icon: "shield" }, { value: "SHA256", label: "SHA-256", icon: "shield" }, { value: "SHA512", label: "SHA-512", icon: "shield" }
      ] });
      algorithm.addEventListener("change", () => { options.algorithm = algorithm.value; update(); });
      const digits = OTP.ui.select({ value: "6", label: "验证码位数", items: [{ value: "6", label: "6 位", icon: "code" }, { value: "8", label: "8 位", icon: "code" }] });
      digits.addEventListener("change", () => { options.digits = digits.value; update(); });
      const period = el("input", { type: "number", value: "30", min: 1, max: 86400, step: 1, "aria-label": "周期（秒）", oninput: () => { options.period = period.value; update(); } });
      optionControls = [algorithm, digits, period];
      advanced.append(el("summary", { text: "高级参数" }), el("p", { class: "otp-advanced-note", text: "仅对 Base32 密钥生效；otpauth 链接使用链接内的参数。" }),
        el("div", { class: "otp-options" },
          el("div", {}, el("span", { text: "摘要算法" }), el("div", { class: "field-input" }, algorithm)),
          el("div", {}, el("span", { text: "位数" }), el("div", { class: "field-input" }, digits)),
          el("label", {}, el("span", { text: "周期 / 秒" }), el("div", { class: "field-input" }, period))));
      setOptions = values => {
        algorithm.setValue(String(values.algorithm || "SHA1").toUpperCase().replace("-", ""));
        digits.setValue(String(values.digits || "6")); period.value = values.period ?? "30";
      };
    }
    const pageLink = el("a", { class: "otp-open", href: new URL("api.html", location.href).href, target: "_blank", rel: "noopener", "aria-label": "打开独立验证码页面", html: icon("monitor", 13) });
    const header = el("div", { class: "otp-head" }, el("label", { htmlFor: input.id, text: expanded ? "OTP 密钥" : "临时验证码" }),
      el("span", { class: "otp-local", text: "本机计算" }), ...(expanded ? [] : [pageLink]));
    host.classList.add("otp-widget");
    const content = el("div", { class: "otp-fold-content" }, el("div", { class: "otp-input-wrap" }, input, eye, clear),
      ...(expanded ? [advanced] : []),
      el("div", { class: "otp-result" }, el("div", { class: "otp-code-group" }, code, meta), ring, copy), hint);
    const fold = el("div", { class: "otp-fold-grid", id: prefix + "-body" }, el("div", { class: "otp-fold-clip" }, content));
    const toggle = el("button", { class: "otp-fold-toggle", type: "button", "aria-expanded": "false", "aria-controls": fold.id,
      onclick: () => { setOpen(!opened); if (opened) input.focus({ preventScroll: true }); } },
      el("span", { text: "临时验证码" }), el("span", { class: "otp-fold-arrow", html: icon("chevron-down", 13), "aria-hidden": "true" }));
    if (collapsible) {
      header.querySelector("label").replaceWith(toggle);
      input.setAttribute("aria-label", "OTP 密钥");
      host.classList.add("is-collapsible");
      host.append(header, fold);
      setOpen(false);
    } else host.append(header, content);
    function setOpen(value) {
      if (!collapsible) return;
      opened = value;
      host.dataset.otpOpen = String(value);
      toggle.setAttribute("aria-expanded", String(value));
      fold.setAttribute("aria-hidden", String(!value));
      fold.inert = !value;
      if (!value) { if (fold.contains(document.activeElement)) toggle.focus(); session.pause(); }
      else if (!document.hidden) session.resume();
    }
    function update(extraOptions) {
      uiRevision++;
      clearTimeout(feedbackTimer); feedbackTimer = 0;
      copy.innerHTML = icon("copy", 14) + "<span>复制</span>";
      if (expanded) {
        const fromUri = /^otpauth:/i.test(input.value.trim());
        const parsed = fromUri ? OTP.otpInput.parse(input.value) : null;
        setOptions(parsed?.account || options);
        optionControls.forEach(control => { control.disabled = fromUri; });
      }
      session.setInput(input.value, extraOptions || (/^otpauth:/i.test(input.value.trim()) ? {} : options));
    }
    function reset() { input.value = ""; input.type = "password"; eye.setAttribute("aria-pressed", "false"); eye.setAttribute("aria-label", "显示 OTP 密钥"); eye.innerHTML = icon("eye", 15); update(); }
    input.addEventListener("input", () => update());
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); reset(); }
      if (e.key === "Enter" && !e.isComposing && !copy.disabled) { e.preventDefault(); copy.click(); }
    });
    const visibility = () => { if (document.hidden || !opened) session.pause(); else session.resume(); };
    document.addEventListener("visibilitychange", visibility);
    const pagehide = () => { reset(); session.pause(); };
    const pageshow = () => { if (!document.hidden && opened) session.resume(); };
    global.addEventListener("pagehide", pagehide);
    global.addEventListener("pageshow", pageshow);
    if (document.hidden) session.pause();
    return { clear() { reset(); setOpen(false); }, focus() { setOpen(true); input.focus(); },
      setInput(raw, values = {}) { Object.keys(options).forEach(key => delete options[key]); Object.assign(options, values); setOptions?.(values); input.value = raw; update(values); },
      showError(message) { reset(); host.dataset.otpStatus = "error"; input.setAttribute("aria-invalid", "true"); hint.textContent = message; },
      destroy() { disposed = true; clearTimeout(feedbackTimer); session.destroy(); document.removeEventListener("visibilitychange", visibility);
        global.removeEventListener("pagehide", pagehide); global.removeEventListener("pageshow", pageshow); host.replaceChildren(); } };
  };
})(globalThis);
