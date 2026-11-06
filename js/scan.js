/* 三种输入共用一份解析预览；仅在点击保存时写入账号库。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, { el, icon } = OTP;
  const store = OTP.store, ui = OTP.ui;
  function open(initialBlob) {
    let disposed = false, revision = 0, account = null, busy = false;
    const captureAbort = new AbortController();
    const status = el("p", { class: "scan-status", role: "status", text: "二维码和链接只在本机解析" });
    const input = el("textarea", { id: "scan-link", class: "imp-input", rows: 2, spellcheck: false, autocomplete: "off",
      maxLength: 24576, placeholder: "粘贴 otpauth:// 链接、OTP 分享链接或 Base32 密钥", "aria-label": "OTP 链接或密钥" });
    const file = el("input", { id: "scan-file", type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/bmp", hidden: true });
    const name = el("input", { id: "scan-name", type: "text", autocomplete: "off", placeholder: "可选，邮箱或账号名" });
    const issuer = el("input", { id: "scan-issuer", type: "text", autocomplete: "off", placeholder: "可选，例如 GitHub" });
    const code = el("output", { class: "scan-code", text: "··· ···", "aria-label": "当前验证码" });
    const meta = el("span", { class: "scan-meta" });
    const copy = el("button", { class: "btn btn-ghost btn-xs", type: "button", text: "复制验证码", disabled: true,
      onclick: async () => { const ok = await session.copy(OTP.copyText); if (!disposed) ui.toast(ok ? "已复制验证码" : "复制失败，请重试", ok ? "ok" : "bad"); } });
    const save = el("button", { id: "scan-save", class: "btn btn-primary", type: "button", text: "保存 OTP", disabled: true, onclick: saveAccount });
    const preview = el("div", { class: "scan-preview", hidden: true },
      el("button", { class: "btn btn-ghost btn-xs scan-again", type: "button", text: "重新导入", onclick: () => { reset(); input.value = ""; status.textContent = "二维码和链接只在本机解析"; input.focus(); } }),
      el("div", { class: "scan-result" }, el("div", {}, code, meta), copy),
      OTP.sheetUI.field("服务名称", issuer, { optional: true }).node,
      OTP.sheetUI.field("账号", name, { optional: true }).node,
      el("p", { class: "field-hint", text: "可以只保存 OTP，无需填写邮箱或密码" }));
    const session = OTP.createOtpSession({ onState: state => {
      if (disposed) return;
      code.textContent = state.status === "ready" ? OTP.fmt.group(state.code) : "··· ···";
      copy.disabled = state.status !== "ready";
      meta.textContent = state.status === "ready" ? `${OTP.totp.ALGO_LABEL[state.algorithm]} · ${state.digits} 位 · ${state.remaining} 秒后刷新` : "正在计算…";
    } });
    const capture = el("button", { id: "scan-capture", class: "scan-source", type: "button",
      onclick: async () => {
        if (busy) return;
        busy = true; capture.disabled = true;
        const popup = document.body.dataset.surface === "popup";
        status.textContent = popup ? "正在打开当前网页的扫码蒙版…" : "请选择要截取的网页或窗口…";
        try {
          if (popup) {
            if (!OTP.access.available) throw new Error("请在浏览器扩展小窗中截取当前网页，网页预览请使用管理页");
            const result = await OTP.access.scan("scan-capture", { theme:OTP.scanTheme() });
            if (result.ok) {
              status.textContent = "网页蒙版已打开，请框选二维码";
              if (!document.documentElement.dataset.floating && !await chrome.tabs.getCurrent()) global.close();
              return;
            }
            throw new Error(result.error || "请在需要扫码的网页上点击扩展图标后重试");
          }
          const blob = await OTP.captureFromPicker({ signal:captureAbort.signal });
          if(disposed)return;
          if(!blob){status.textContent="已取消截图，可重新选择";return;}
          const cropped = await OTP.cropQr(blob,{theme:OTP.scanTheme(),signal:captureAbort.signal});
          if(!disposed){if(cropped)await readImage(cropped);else status.textContent="已取消框选";}
        } catch (error) { if (!disposed) status.textContent = error.message || "截图失败，请重试"; }
        finally { busy = false; capture.disabled = false; }
      } }, el("span", { html: icon("scan", 22) }), el("b", { text: "截取网页" }), el("small", { text: document.body.dataset.surface === "page" || !OTP.access.available ? "选择网页或窗口后框选" : "当前网页蒙版框选" }));
    const pick = el("button", { class: "scan-source", type: "button", onclick: () => file.click() },
      el("span", { html: icon("image", 22) }), el("b", { text: "本地图片" }), el("small", { text: "选择或拖入 QR 图" }));
    const parseButton = el("button", { id: "scan-parse", class: "btn btn-ghost btn-xs", type: "button", text: "解析链接", onclick: () => show(input.value) });
    const body = el("div", { class: "scan-pane" }, el("div", { class: "scan-sources" }, capture, pick), file,
      el("div", { class: "card-box" }, el("div", { class: "card-head" }, el("span", { class: "t", text: "从链接导入" }), parseButton), input), status, preview);
    function reset() {
      revision++; account = null; preview.hidden = true; save.disabled = true; session.clear();
      body.classList.remove("has-result");
      status.classList.remove("is-error");
    }
    function show(raw) {
      reset();
      const parsed = OTP.qr.parse(raw);
      if (!parsed.account) { status.textContent = parsed.error || "请先输入 OTP 链接或密钥"; status.classList.add("is-error"); return; }
      account = parsed.account; name.value = account.email || account.account || ""; issuer.value = account.issuer || "";
      preview.hidden = false; save.disabled = false; status.textContent = "已识别 OTP · 可直接复制验证码或保存";
      body.classList.add("has-result"); ui.refs.sheetBody.scrollTop = 0;
      session.setInput(account.secret, { algorithm: account.algorithm, digits: account.digits, period: account.period });
      // 解析成功后清除含密钥的输入，预览仅展示账号与参数。
      input.value = "";
    }
    async function readImage(blob) {
      reset(); const current = revision;
      status.textContent = "正在本机识别二维码…";
      try {
        const raw = await OTP.qr.decode(blob);
        if (!disposed && current === revision) show(raw);
      } catch (err) {
        if (!disposed && current === revision) { status.textContent = err.message; status.classList.add("is-error"); }
      }
    }
    async function saveAccount() {
      if (!account || busy || disposed) return;
      if (store.accounts().some(item => item.secret === account.secret && item.algorithm === account.algorithm && item.digits === account.digits && item.period === account.period)) {
        ui.toast("这个 OTP 已在账号库中，无需重复保存", "warn"); return;
      }
      busy = true; save.disabled = true;
      try {
        store.createAccount({ ...account, email: name.value.trim(), issuer: issuer.value.trim(), password: "" });
        await store.persist();
        if (disposed) return;
        ui.closeSheet(true); OTP.sheetUI.changed("scan"); ui.toast("OTP 已保存");
      } catch (_) { if (!disposed) ui.toast("保存失败，请重试", "bad"); }
      finally { busy = false; save.disabled = false; }
    }
    file.addEventListener("change", () => { if (file.files[0]) readImage(file.files[0]); file.value = ""; });
    input.addEventListener("input", reset);
    input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); show(input.value); } });
    body.addEventListener("dragover", event => { event.preventDefault(); body.classList.add("is-over"); });
    body.addEventListener("dragleave", () => body.classList.remove("is-over"));
    body.addEventListener("drop", event => { event.preventDefault(); body.classList.remove("is-over"); const blob = event.dataTransfer.files[0]; if (blob) readImage(blob); });
    const paste = event => { const blob = event.clipboardData?.files[0]; if (blob) { event.preventDefault(); readImage(blob); } };
    const visibility = () => { if (document.hidden) session.pause(); else session.resume(); };
    document.addEventListener("paste", paste); document.addEventListener("visibilitychange", visibility);
    ui.openSheet({ title: "扫码与导入 OTP", subtitle: "网页框选 · 本地图片 · OTP 链接", body,
      footer: el("div", { class: "row-btns" }, el("button", { class: "btn btn-ghost", type: "button", text: "关闭", onclick: () => ui.closeSheet(true) }), save),
      onClose: () => { disposed = true; captureAbort.abort(); revision++; account = null; input.value = ""; session.destroy(); document.removeEventListener("paste", paste); document.removeEventListener("visibilitychange", visibility); } });
    if (initialBlob) readImage(initialBlob);
  }
  OTP.scan = { open };
})(globalThis);
