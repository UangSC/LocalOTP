/* 账号编辑表单。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { field, advRow, randomPassword, group, changed } = OTP.sheetUI;
  async function openEditor(account) {
    if (account?.password && !await OTP.sensitive.ensure("查看或编辑账号密码")) return;
    if (document.querySelector("#screen")?.inert) return;
    const isEdit = !!account;
    const adv = {
      algorithm: account ? account.algorithm : "SHA1",
      digits: account ? account.digits : 6,
      period: account ? account.period : 30,
    };

    /* ---- 字段 ---- */

    const emailInput = el("input", {
      id: "f-email",
      type: "text",
      placeholder: "someone@example.com",
      value: account ? account.email : "",
      autocomplete: "off",
      spellcheck: false,
    });
    const emailField = field("邮箱或账号名", emailInput, { optional: true });

    const passInput = el("input", {
      id: "f-pass",
      type: "password",
      placeholder: "原样保存，区分大小写",
      value: account ? account.password : "",
      autocomplete: "new-password",
      spellcheck: false,
    });
    const eyeBtn = el("button", {
      class: "eye",
      type: "button",
      "aria-label": "显示密码",
      "data-tip": "显示 / 隐藏",
      html: icon("eye", 15, "i-sm"),
      onclick: async () => {
        if (account?.password && !await restorePassword()) return;
        const show = passInput.type === "password";
        passInput.type = show ? "text" : "password";
        eyeBtn.innerHTML = icon(show ? "eye-off" : "eye", 15, "i-sm");
        passInput.focus();
      },
    });
    const diceBtn = el("button", {
      class: "eye",
      type: "button",
      "aria-label": "生成随机密码",
      "data-tip": "生成 16 位随机密码",
      html: icon("sparkle", 15, "i-sm"),
      onclick: () => {
        passInput.value = randomPassword(16);
        passInput.type = "text";
        eyeBtn.innerHTML = icon("eye-off", 15, "i-sm");
        passInput.focus();
        passInput.setSelectionRange(passInput.value.length, passInput.value.length);
      },
    });
    const passField = field("默认密码", passInput, {
      optional: true,
      extra: [diceBtn, eyeBtn],
    });

    const issuerInput = el("input", {
      id: "f-issuer",
      type: "text",
      placeholder: "可选，例如 GitHub",
      value: account ? account.issuer : "",
      autocomplete: "off",
      spellcheck: false,
    });
    const issuerField = field("服务名称", issuerInput, { optional: true });

    const secretInput = el("input", {
      id: "f-secret",
      type: "text",
      class: "mono",
      placeholder: "Base32，例如 JBSWY3DPEHPK3PXP",
      value: account ? account.secret : "",
      autocomplete: "off",
      spellcheck: false,
    });
    const secretField = field("2FA 密钥", secretInput, {
      required: true,
      error: "密钥无效",
      hint: "自动转大写并忽略空格；不会猜测或补全非法密钥",
    });

    const noteInput = el("input", {
      id: "f-note",
      type: "text",
      placeholder: "可选，例如「仅用于找回」",
      value: account ? account.note : "",
      autocomplete: "off",
    });
    const noteField = field("备注", noteInput, { optional: true });

    const categorySelect = ui.select({
      label: "分类",
      value: account ? account.categoryId || "" : "",
      items: [{ value: "", label: "未分类", icon: "folder" },
        ...store.categories().map(cat => ({ value: cat.id, label: cat.name, icon: cat.icon }))],
    });

    const categoryField = field("分类", categorySelect, { optional: true });

    /* ---- 实时预览 ---- */

    const liveCode = el("div", { class: "live-code", text: "··· ···" });
    const liveRing = ui.createRing({ period: adv.period });
    const liveBox = el(
      "div",
      { class: "live", hidden: true },
      el("div", {}, el("div", { class: "live-label", text: "实时预览" }), liveCode),
      liveRing.node
    );

    /* ---- 高级参数 ---- */

    const algoSeg = ui.segmented({
      active: adv.algorithm,
      items: [
        { id: "SHA1", label: "SHA-1" },
        { id: "SHA256", label: "SHA-256" },
        { id: "SHA512", label: "SHA-512" },
      ],
      onChange: (id) => {
        adv.algorithm = id;
        updateSummary();
        refreshLive();
      },
    });

    const digitsSeg = ui.segmented({
      active: String(adv.digits),
      items: [
        { id: "6", label: "6 位" },
        { id: "8", label: "8 位" },
      ],
      onChange: (id) => {
        adv.digits = Number(id);
        updateSummary();
        refreshLive();
      },
    });

    const periodSeg = ui.segmented({
      active: String(adv.period),
      className: "seg-sm",
      items: [
        { id: "30", label: "30 秒" },
        { id: "60", label: "60 秒" },
        ...([30, 60].includes(adv.period) ? [] : [{ id: String(adv.period), label: adv.period + " 秒" }]),
      ],
      onChange: (id) => {
        adv.period = Number(id);
        liveRing.setPeriod(adv.period);
        updateSummary();
        refreshLive();
      },
    });

    const summary = el("span", { class: "adv-right" });
    const advToggle = el(
      "button",
      { class: "adv-toggle", type: "button" },
      el("span", { text: "高级参数" }),
      el("span", { class: "adv-right" }, summary, el("span", { html: icon("chevron-down", 14) }))
    );
    const advBox = el(
      "div",
      { class: "adv" },
      el(
        "div",
        {},
        el(
          "div",
          { class: "adv-inner" },
          advRow("算法", algoSeg.node),
          advRow("位数", digitsSeg.node),
          advRow("周期", periodSeg.node)
        )
      )
    );
    advToggle.addEventListener("click", () => {
      const open = advBox.classList.toggle("is-open");
      advToggle.classList.toggle("is-open", open);
    });

    function updateSummary() {
      summary.textContent =
        (OTP.totp.ALGO_LABEL[adv.algorithm] || "SHA-1") + " · " + adv.digits + " 位 · " + adv.period + " 秒";
    }
    updateSummary();

    /* ---- 实时预览刷新 ---- */

    let liveTimer = 0;
    let liveCounter = -1;

    async function refreshLive() {
      const check = OTP.totp.validateSecret(secretInput.value);
      if (!check.ok) {
        liveBox.hidden = true;
        liveCounter = -1;
        return;
      }
      liveBox.hidden = false;
      const cycle = OTP.totp.cycle(adv.period);
      liveRing.paint({
        progress: cycle.progress,
        seconds: Math.max(0, Math.ceil(cycle.remaining)),
        state: cycle.remaining <= 4.5 ? "hot" : cycle.remaining <= 10 ? "warn" : "calm",
      });
      liveCounter = cycle.counter;
      try {
        const result = await OTP.totp.generate(
          { secret: check.normalized, algorithm: adv.algorithm, digits: adv.digits, period: adv.period },
          Date.now()
        );
        liveCode.textContent = OTP.fmt.group(result.code);
      } catch (err) {
        liveCode.textContent = "—— ——";
      }
    }

    secretInput.addEventListener("input", () => {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(refreshLive, 240);
    });

    secretInput.addEventListener("blur", () => {
      const check = OTP.totp.validateSecret(secretInput.value);
      if (check.ok) secretInput.value = check.normalized;
    });

    const liveTick = setInterval(() => {
      if (!ui.isSheetOpen() || liveBox.hidden) return;
      const cycle = OTP.totp.cycle(adv.period);
      liveRing.paint({
        progress: cycle.progress,
        seconds: Math.max(0, Math.ceil(cycle.remaining)),
        state: cycle.remaining <= 4.5 ? "hot" : cycle.remaining <= 10 ? "warn" : "calm",
      });
      if (cycle.counter !== liveCounter) {
        liveCounter = cycle.counter;
        refreshLive();
      }
    }, 700);

    /* ---- 组装 ---- */

    const body = el(
      "div",
      { class: "form" },
      emailField.node,
      passField.node,
      issuerField.node,
      secretField.node,
      liveBox,
      categoryField.node,
      noteField.node,
      advToggle,
      advBox
    );

    const cancel = el("button", {
      class: "btn btn-ghost",
      type: "button",
      text: "取消",
      onclick: () => ui.closeSheet(true),
    });
    const save = el("button", {
      class: "btn btn-primary",
      type: "button",
      html: icon("check", 15, "i-sm") + "<span>" + (isEdit ? "保存修改" : "保存账号") + "</span>",
      onclick: submit,
    });

    async function submit() {
      if (account?.password && !await restorePassword()) return;
      const email = emailInput.value.trim();
      const password = passInput.value;
      const secretRaw = secretInput.value;
      const check = OTP.totp.validateSecret(secretRaw);

      const emailOk = !email.includes("@") || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

      // 同一邮箱不能重复（编辑自己除外）
      const duplicate = store
        .accounts()
        .find(
          (item) =>
            email && item.email.trim().toLowerCase() === email.toLowerCase() &&
            (!account || item.id !== account.id)
        );

      emailField.setError(
        !emailOk ? "请输入有效的邮箱地址" : duplicate ? "这个邮箱已经存在" : ""
      );
      secretField.setError(check.ok ? "" : check.error);

      if (!emailOk || duplicate || !check.ok) {
        const firstBad = body.querySelector(".field.is-bad");
        if (firstBad) firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
        OTP.flash(body.querySelector(".field.is-bad .field-input"), "is-bad", 400);
        return;
      }

      const payload = {
        email,
        password,
        issuer: issuerInput.value.trim(),
        secret: check.normalized,
        note: noteInput.value.trim(),
        categoryId: categorySelect.value,
        algorithm: adv.algorithm,
        digits: adv.digits,
        period: adv.period,
      };

      if (isEdit) {
        store.updateAccount(account.id, payload);
        ui.closeSheet(true);
        ui.toast("账号已更新");
      } else {
        const created = store.createAccount(payload);
        ui.closeSheet(true);
        ui.toast("已添加账号");
        setTimeout(() => {
          OTP.list.scrollToId(created.id, { center: true });
          const node = OTP.list.getRef(created.id);
          if (node) OTP.flash(node.node, "is-active", 1400);
        }, 240);
      }

      changed("editor");
    }

    ui.openSheet({
      title: isEdit ? "编辑账号" : "新增账号",
      subtitle: isEdit ? account.email || account.issuer || "未命名 OTP" : "只需 OTP 密钥，邮箱、密码与服务名称均可选",
      body,
      footer: [cancel, save],
      onClose: () => {
        algoSeg.destroy(); digitsSeg.destroy(); periodSeg.destroy();
        clearInterval(liveTick);
        clearTimeout(liveTimer);
        clearInterval(passwordTimer);
        hiddenPassword = ""; passInput.value = "";
        liveRing.destroy();
      },
    });

    let hiddenPassword = null;
    async function restorePassword() {
      if (!await OTP.sensitive.ensure("查看或编辑账号密码") || !body.isConnected || document.querySelector("#screen")?.inert) return false;
      if (hiddenPassword !== null) { passInput.value = hiddenPassword; hiddenPassword = null; }
      passInput.disabled = false; passInput.placeholder = "可选";
      return true;
    }
    const passwordTimer = setInterval(() => {
      if (!account?.password || hiddenPassword !== null) return;
      if (Date.now() < OTP.sensitive.verifiedUntil) return;
      hiddenPassword = passInput.value; passInput.value = ""; passInput.type = "password"; passInput.disabled = true;
      passInput.placeholder = "验证已过期，点击眼睛重新验证";
    }, 500);
    for (const type of ["copy", "cut"]) passInput.addEventListener(type, async event => {
      if (!account?.password) return;
      event.preventDefault();
      if (await restorePassword()) await OTP.copyText(passInput.value);
    });

    if (secretInput.value) refreshLive();
    // 一行代码的行为细节：Esc 由 app 统一分发，这里只保证输入框回车能提交
    for (const input of [emailInput, passInput, issuerInput, secretInput, noteInput]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      });
    }
  }

  /* 快速添加（小窗专用） 一行一条，粘贴 / 手打都能用；边打边解析，先把"能不能加"说清楚。 */


  Object.assign(OTP.sheetParts, { openEditor });
})(globalThis);
