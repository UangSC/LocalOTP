/* 敏感操作统一验证。进入免密码不等于一小时内实际验证过密码。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, { el, icon } = OTP;
  let pending = null, verifiedUntil = 0;
  async function ensure(label = "查看账号密码") {
    try {
      const result = await OTP.access.sensitive();
      if (result.ok) { verifiedUntil = result.verifiedUntil; return true; }
      if (result.code === "AUTH_REQUIRED") {
        OTP.ui.toast("当前页面授权已失效，请重新解锁", "warn");
        await OTP.app.lock();
        return false;
      }
      if (pending) return pending;
      pending = prompt(label);
      return await pending;
    } catch (error) { OTP.ui.toast(error.message || "验证服务不可用，请重试", "bad"); return false; }
    finally { pending = null; }
  }
  function prompt(label) {
    return new Promise(resolve => {
      let busy = false, done = false;
      const input = el("input", { id: "sensitive-password", type: "password", autocomplete: "current-password", placeholder: "输入管理密码", "aria-label": "管理密码" });
      const error = el("p", { class: "field-err is-show", role: "alert" });
      const submit = el("button", { type: "submit", class: "btn btn-primary", text: "验证并继续" });
      const cancel = el("button", { type: "button", class: "btn btn-ghost", text: "取消", onclick: () => finish(false) });
      const dialog = el("dialog", { class: "sensitive-dialog", "aria-labelledby": "sensitive-title" },
        el("div", { class: "scan-symbol", html: icon("shield", 24) }),
        el("h2", { id: "sensitive-title", text: "验证管理密码" }),
        el("p", { class: "sensitive-description", text: `${label}须在 1 小时内验证过管理密码。验证后，本小时内无需重复输入。` }),
        el("form", {}, el("div", { class: "field-input" }, input), error,
          el("div", { class: "row-btns" }, cancel, submit)));
      const closeOnLock = () => { if (document.querySelector("#screen")?.inert) finish(false); };
      const observer = new MutationObserver(closeOnLock);
      const screen = document.querySelector("#screen");
      if (screen) observer.observe(screen, { attributes: true, attributeFilter: ["inert"] });
      function finish(ok) {
        if (done) return;
        done = true; input.value = ""; observer.disconnect(); dialog.close(); dialog.remove(); resolve(ok);
      }
      dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
      dialog.addEventListener("keydown", event => event.stopPropagation());
      dialog.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        if (busy || !input.value) return;
        busy = true; submit.disabled = true; error.textContent = "";
        try {
          const result = await OTP.access.sensitive(input.value);
          if (done) return;
          if (result.ok) { verifiedUntil = result.verifiedUntil; finish(true); }
          else { error.textContent = "管理密码不正确，请重试"; input.select(); }
        } catch (err) { if (!done) error.textContent = err.message || "验证失败，请重试"; }
        finally { busy = false; submit.disabled = false; }
      });
      document.body.append(dialog); dialog.showModal(); input.focus();
    });
  }
  OTP.sensitive = { ensure, get verifiedUntil() { return verifiedUntil; } };
})(globalThis);
