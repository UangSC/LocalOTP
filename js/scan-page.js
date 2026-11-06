/* 网页中的识别结果。只接触此次扫码，不读取已保存的账号库。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  if (OTP.scanPage) return;
  let active = null;
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "localotp:scan-close" && active?.token === message.token) active.close();
  });
  OTP.scanPage = {
    start(image, options) {
      active?.close();
      const abort = new AbortController();
      let host,
        timer,
        expiry,
        closed = false,
        current = null,
        requesting = false;
      const send = (action, extra = {}) =>
        chrome.runtime.sendMessage({ type: "localotp:scan-page", token: options.token, action, ...extra });
      function close() {
        if (closed) return;
        closed = true;
        abort.abort();
        clearInterval(timer);
        clearTimeout(expiry);
        host?.remove();
        current = null;
      global.removeEventListener("pagehide", close);
        send("cancel").catch(() => {});
        if (active?.token === options.token) active = null;
      }
      active = { token: options.token, close };
    global.addEventListener("pagehide", close, { once: true });
      expiry = setTimeout(close, Math.max(0, options.expires - Date.now()));
      const make = (tag, text, cls) => {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (cls) node.className = cls;
        return node;
      };
      async function preview(raw, decodeError) {
        let saving = false,
          saved = false;
        if (closed) return;
        host = make("div");
        host.id = "localotp-scan-result";
        const root = host.attachShadow({ mode: "closed" });
        const style = make("style");
        style.textContent = `:host{all:initial}*{box-sizing:border-box}dialog{position:fixed;inset:0;margin:auto;width:min(390px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;padding:24px;border:1px solid var(--line);border-radius:20px;background:var(--surface);color:var(--ink);font:14px/1.6 system-ui,sans-serif;box-shadow:0 18px 70px #0005;cursor:default}dialog::backdrop{background:#0005}h2{margin:0 0 4px;font-size:19px}p{margin:8px 0;color:var(--ink-2);font-size:12px}input{width:100%;padding:10px 12px;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:10px;font:inherit;cursor:text}label{display:block;margin-top:12px;font-size:12px}output{font:600 30px/1.4 Consolas,"Cascadia Code",ui-monospace,monospace;color:var(--brand-ink);display:block;letter-spacing:2px}button{font:inherit;padding:9px 12px;border-radius:10px;color:var(--ink);background:transparent;border:1px solid var(--line);cursor:pointer}button.primary{background:var(--brand);border-color:var(--brand);color:var(--on-brand,#fff)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--brand);outline-offset:3px}.result{padding:16px 0}.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}.hint{min-height:20px} [hidden]{display:none!important}`;
        const dialog = make("dialog");
        dialog.setAttribute("aria-label", "识别 OTP");
        for (const [key, value] of Object.entries({
          surface: "#fff",
          ink: "#263749",
          "ink-2": "#526273",
          brand: "#2563eb",
          "brand-ink": "#2563eb",
          line: "#dce5ef",
          "on-brand": "#fff",
        }))
          dialog.style.setProperty("--" + key, options.theme?.[key] || value);
        const status = make("p", "正在本机解析…", "hint"),
          code = make("output", "··· ···"),
          meta = make("p"),
          issuer = make("input"),
          email = make("input");
        issuer.maxLength = email.maxLength = 256;
        issuer.autocomplete = email.autocomplete = "off";
        issuer.id = "scan-page-issuer";
        email.id = "scan-page-email";
        const result = make("div", null, "result");
        result.append(code, meta);
        const issuerLabel = make("label", "服务名称（可选）"),
          emailLabel = make("label", "账号（可选）");
        issuerLabel.append(issuer);
        emailLabel.append(email);
        const copy = make("button", "复制验证码"),
          save = make("button", "保存 OTP", "primary"),
          cancel = make("button", "关闭");
        copy.disabled = save.disabled = true;
        copy.id = "scan-page-copy";
        save.id = "scan-page-save";
        const actions = make("div", null, "actions");
        actions.append(cancel, copy, save);
        dialog.append(
          make("h2", "扫码结果"),
          make("p", "仅此次扫码 · 本机解析"),
          status,
          result,
          issuerLabel,
          emailLabel,
          actions,
        );
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(style.textContent);
        root.adoptedStyleSheets = [sheet];
        root.append(dialog);
        document.documentElement.append(host);
        dialog.showModal();
        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          close();
        });
        dialog.addEventListener("keydown", (event) => event.stopPropagation());
        cancel.onclick = close;
        function paint(reply) {
          if (saving || saved) return;
          current = reply;
          code.textContent = reply.code.replace(/(\d{3,4})(\d{3,4})$/, "$1 $2");
          meta.textContent = `${reply.account.algorithm} · ${reply.account.digits} 位 · ${Math.max(0, Math.ceil((reply.expires - Date.now()) / 1000))} 秒后刷新`;
          copy.disabled = save.disabled = false;
        }
        async function refresh() {
          if (closed || requesting || saving || saved) return;
          requesting = true;
          try {
            const reply = await send("code");
            if (closed || saved) return;
            if (!reply.ok) throw Error(reply.error);
            paint(reply);
          } catch (error) {
            status.textContent = error.message || "无法刷新验证码";
            copy.disabled = true;
            code.textContent = "··· ···";
          } finally {
            requesting = false;
          }
        }
        try {
          if (decodeError) throw Error(decodeError);
          const reply = await send("preview", { raw });
          raw = "";
          if (closed || saved) return;
          if (!reply.ok) throw Error(reply.error);
          paint(reply);
          issuer.value = reply.account.issuer;
          email.value = reply.account.email;
          status.textContent = "已识别，可以直接保存 OTP";
          timer = setInterval(() => {
            if (!current || document.hidden) return;
            if (current.expires <= Date.now()) {
              copy.disabled = true;
              refresh();
            } else
              meta.textContent = `${current.account.algorithm} · ${current.account.digits} 位 · ${Math.ceil((current.expires - Date.now()) / 1000)} 秒后刷新`;
          }, 250);
        } catch (error) {
          status.textContent = error.message || "无法解析二维码";
          result.hidden = issuerLabel.hidden = emailLabel.hidden = true;
        }
        copy.onclick = async () => {
          if (saving || saved) return;
          copy.disabled = true;
          try {
            const reply = await send("code");
            if (closed || saved) return;
            if (!reply.ok) throw Error(reply.error);
            const ok = await OTP.copyText(reply.code, dialog);
            status.textContent = ok ? "已复制验证码" : "复制失败，请重试";
            paint(reply);
          } catch (error) {
            status.textContent = error.message || "复制失败";
          }
        };
        save.onclick = async () => {
          if (saving || saved) return;
          saving = true;
          save.disabled = true;
          try {
            const reply = await send("save", { email: email.value, issuer: issuer.value });
            if (closed || saved) return;
            if (!reply.ok) throw Error(reply.error);
            saved = true;
            status.textContent = reply.duplicate ? "该 OTP 已存在，无需重复保存" : "OTP 已保存";
            copy.disabled = save.disabled = true;
            clearInterval(timer);
            clearTimeout(expiry);
            expiry = setTimeout(close, 1200);
          } catch (error) {
            saving = false;
            status.textContent = error.message || "保存失败";
            save.disabled = false;
          }
        };
      }
      (async () => {
        try {
          const blob = await (await fetch(image)).blob();
          image = "";
          const cropped = await OTP.cropQr(blob, { theme: options.theme, signal: abort.signal });
          if (!cropped || closed) {
            close();
            return;
          }
          try {
            await preview(await OTP.qr.decode(cropped));
          } catch (error) {
            await preview("", error.message);
          }
        } catch (_) {
          close();
        }
      })();
    },
  };
})(globalThis);
