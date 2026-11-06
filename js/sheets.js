/* ==========================================================================
   LocalOTP · sheets
   抽屉里的三块内容：账号编辑、批量导入、设置。以及改密、分类管理。
   ========================================================================== */

(function (global) {
  "use strict";

  const OTP = global.OTP;
  const { el, icon } = OTP;
  const store = OTP.store;
  const ui = OTP.ui;

  let onChangedCallback = null;

  function setOnChanged(fn) {
    onChangedCallback = fn;
  }

  function changed(reason) {
    if (onChangedCallback) onChangedCallback(reason);
  }

  /* ==========================================================================
     账号编辑
     ========================================================================== */

  function openEditor(account) {
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
    const emailField = field("邮箱", emailInput, { required: true, error: "请输入有效的邮箱地址" });

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
      onclick: () => {
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
      required: true,
      error: "密码不能为空",
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

    function submit() {
      const email = emailInput.value.trim();
      const password = passInput.value;
      const secretRaw = secretInput.value;
      const check = OTP.totp.validateSecret(secretRaw);

      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

      // 同一邮箱不能重复（编辑自己除外）
      const duplicate = store
        .accounts()
        .find(
          (item) =>
            item.email.trim().toLowerCase() === email.toLowerCase() &&
            (!account || item.id !== account.id)
        );

      emailField.setError(
        !emailOk ? "请输入有效的邮箱地址" : duplicate ? "这个邮箱已经存在" : ""
      );
      passField.setError(password.length ? "" : "密码不能为空");
      secretField.setError(check.ok ? "" : check.error);

      if (!emailOk || duplicate || !password.length || !check.ok) {
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
      subtitle: isEdit ? account.email : "邮箱、默认密码与 TOTP 密钥都保存在本机",
      body,
      footer: [cancel, save],
      onClose: () => {
        clearInterval(liveTick);
        clearTimeout(liveTimer);
        liveRing.destroy();
      },
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

  /* ==========================================================================
     快速添加（小窗专用）
     一行一条，粘贴 / 手打都能用；边打边解析，先把"能不能加"说清楚。
     ========================================================================== */

  function openQuickAdd() {
    const textarea = el("textarea", {
      class: "imp-input quick-input",
      rows: "3",
      spellcheck: false,
      placeholder:
        "aurora@example.com----Aurora#2026----JBSWY3DPEHPK3PXP\n" +
        "也认 邮箱--密码--密钥、Tab 或 | 分隔",
    });

    const chips = el("div", { class: "imp-stats quick-stats" });
    const hint = el("div", { class: "quick-hint", hidden: true });

    let parsed = { rows: [], stats: { total: 0, fresh: 0, dup: 0, bad: 0 } };

    const addBtn = el("button", {
      class: "btn btn-primary",
      type: "button",
      text: "添加",
      disabled: true,
      onclick: submit,
    });

    const cancel = el("button", {
      class: "btn btn-ghost",
      type: "button",
      text: "取消",
      onclick: () => ui.closeSheet(true),
    });

    function chip(label, value, cls) {
      return el(
        "span",
        { class: "stat " + (cls || "") },
        el("span", { text: label }),
        el("b", { text: String(value) })
      );
    }

    function renderFeedback() {
      const stats = parsed.stats;
      OTP.clear(chips);
      chips.append(chip("可添加", stats.fresh, stats.fresh ? "is-new" : ""));
      if (stats.dup) chips.append(chip("已存在", stats.dup, "is-dup"));
      if (stats.bad) chips.append(chip("无效", stats.bad, "is-bad"));

      addBtn.disabled = stats.fresh === 0;
      addBtn.textContent = stats.fresh ? `添加 ${stats.fresh} 条` : "添加";

      const firstBad = parsed.rows.find((row) => row.kind === "bad");
      OTP.clear(hint);
      if (firstBad) {
        hint.append(
          el("span", { class: "quick-hint-ico", html: icon("alert-circle", 12, "i-sm") }),
          el("span", { text: `第 ${firstBad.line} 行：${firstBad.reason}` })
        );
        hint.hidden = false;
      } else if (stats.dup) {
        hint.append(el("span", { text: `有 ${stats.dup} 条已存在，本次会跳过` }));
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }

    function parse() {
      parsed = store.parseQuick(textarea.value);
      renderFeedback();
    }

    function submit() {
      const before = new Set(store.accounts().map((a) => a.id));
      const result = store.applyImport(parsed.rows, "skip");
      if (!result.added) {
        ui.toast("没有可添加的记录", "warn");
        return;
      }

      ui.closeSheet(true);
      changed("quick-add");
      ui.toast(`已添加 ${result.added} 条`);

      const fresh = store.accounts().find((a) => !before.has(a.id));
      if (fresh) {
        setTimeout(() => {
          OTP.list.scrollToId(fresh.id, { center: true });
          const ref = OTP.list.getRef(fresh.id);
          if (ref) OTP.flash(ref.node, "is-new-flash", 1200);
        }, 260);
      }
    }

    textarea.addEventListener("input", parse);
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!addBtn.disabled) submit();
      }
    });

    const body = el(
      "div",
      { class: "quick-add" },
      textarea,
      chips,
      hint,
      el("p", {
        class: "field-hint",
        text: "一行一条；密码里如果含 --，请改用 ---- 分隔，避免被切错。",
      })
    );

    ui.openSheet({
      title: "快速添加",
      subtitle: "邮箱 · 密码 · 2FA 密钥，一行搞定",
      body,
      footer: [cancel, addBtn],
    });

    renderFeedback();
  }

  /* ==========================================================================
     表单零件
     ========================================================================== */

  function field(label, input, opts) {
    const o = opts || {};
    const err = el("div", { class: "field-err", role: "alert" });

    const wrap = el(
      "div",
      { class: "field-input" },
      input,
      o.extra || null
    );

    const labelNode = el(
      "span",
      { class: "field-label" },
      el("span", { text: label }),
      o.required ? el("i", { class: "req", text: "*" }) : null,
      o.optional ? el("span", { class: "opt", text: "可选" }) : null
    );

    const node = el(
      "label",
      { class: "field" },
      labelNode,
      wrap,
      o.hint ? el("div", { class: "field-hint", text: o.hint }) : null,
      err
    );

    wrap.addEventListener("focusin", () => node.classList.remove("is-bad"));

    return {
      node,
      input,
      setError(message) {
        if (message) {
          err.textContent = message;
          node.classList.add("is-bad");
        } else {
          err.textContent = "";
          node.classList.remove("is-bad");
        }
      },
    };
  }

  function advRow(label, control) {
    return el("div", { class: "adv-row" }, el("span", { text: label }), control);
  }

  function randomPassword(length) {
    const groups = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+"];
    const all = groups.join("");
    const bytes = new Uint8Array(length);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(bytes);
    else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);

    const chars = [];
    for (let i = 0; i < length; i++) {
      const pool = i < groups.length ? groups[i] : all;
      chars.push(pool[bytes[i] % pool.length]);
    }
    // 打散，避免前缀永远是"小写+大写+数字+符号"
    for (let i = chars.length - 1; i > 0; i--) {
      const j = bytes[i] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  }

  /* ==========================================================================
     设置面板的零件
     ========================================================================== */

  function group(title, rows) {
    return el(
      "div",
      { class: "set-group" },
      el("div", { class: "set-title", text: title }),
      el("div", { class: "set-card" }, rows.filter(Boolean))
    );
  }

  function setRow(opts) {
    const o = opts || {};
    const descEl = el("span", {});
    if (o.desc) descEl.append(document.createTextNode(o.desc));
    if (o.descNode) OTP.appendAll(descEl, [o.descNode]);

    const row = el(
      "div",
      { class: "set-row" + (o.onTap ? " is-tap" : "") },
      el("span", { class: "set-ico", html: icon(o.icon || "settings", 15) }),
      el(
        "span",
        { class: "set-label" },
        el("b", {}, el("span", { text: o.label }), o.badge || null),
        descEl
      ),
      el("span", { class: "set-ctl" }, o.control || null)
    );
    if (o.onTap) {
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.addEventListener("click", (event) => {
        if (event.target.closest("button, .toggle, input, select")) return;
        o.onTap(event);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          o.onTap(event);
        }
      });
    }
    return row;
  }

  /* ==========================================================================
     批量导入
     ========================================================================== */

  const importState = {
    rows: [],
    mode: "skip",
    text: "",
  };

  function importPane() {
    const textarea = el("textarea", {
      class: "imp-input",
      spellcheck: false,
      placeholder: "user@example.com----Password123!----JBSWY3DPEHPK3PXP\n也支持粘贴 otpauth:// 链接",
      value: importState.text,
    });

    const dropzone = el("div", { class: "dropzone" }, textarea);

    const fileInput = el("input", { type: "file", accept: ".txt,text/plain", hidden: true });

    const pickBtn = el("button", {
      class: "btn btn-ghost btn-xs",
      type: "button",
      html: icon("file", 12, "i-sm") + "<span>选择 .txt</span>",
      onclick: () => fileInput.click(),
    });

    const sampleBtn = el("button", {
      class: "btn btn-ghost btn-xs",
      type: "button",
      text: "填入示例",
      onclick: () => {
        textarea.value = OTP.seed.SAMPLE_IMPORT;
        parse();
      },
    });

    const clearBtn = el("button", {
      class: "btn btn-ghost btn-xs",
      type: "button",
      text: "清空",
      onclick: () => {
        textarea.value = "";
        parse();
        textarea.focus();
      },
    });

    const sizeLabel = el("span", { class: "h", text: "0 行" });

    const totalStat = statChip("共", "0", "行");
    const freshStat = statChip("可新增", "0", "");
    const dupStat = statChip("重复", "0", "");
    const badStat = statChip("无效", "0", "");

    const previewList = el("div", { class: "imp-list" });
    const copyErrors = el("button", {
      class: "lnk",
      type: "button",
      text: "复制错误清单",
      onclick: copyErrorList,
    });

    const dupSeg = ui.segmented({
      active: importState.mode,
      className: "seg-sm",
      items: [
        { id: "skip", label: "跳过" },
        { id: "replace", label: "替换" },
        { id: "keep", label: "保留" },
      ],
      onChange: (id) => {
        importState.mode = id;
        renderImport();
      },
    });

    const doImportBtn = el("button", {
      class: "btn btn-primary",
      type: "button",
      text: "导入记录",
      disabled: true,
      onclick: runImport,
    });

    function parse() {
      importState.text = textarea.value;
      const result = store.parseImport(textarea.value);
      importState.rows = result.rows;
      importState.stats = result.stats;
      importState.replaceable = result.replaceable;
      renderImport();
    }

    function renderImport() {
      const rows = importState.rows;
      const stats = importState.stats || { total: 0, fresh: 0, dup: 0, bad: 0 };

      if (totalStat.value) totalStat.value.textContent = String(stats.total);
      freshStat.value.textContent = String(stats.fresh);
      dupStat.value.textContent = String(stats.dup);
      badStat.value.textContent = String(stats.bad);
      sizeLabel.textContent = rows.length + " 行";

      const mode = importState.mode;
      const count =
        mode === "replace"
          ? stats.fresh + (importState.replaceable || 0)
          : mode === "keep"
            ? stats.fresh + stats.dup
            : stats.fresh;

      doImportBtn.disabled = count === 0;
      doImportBtn.textContent = count ? `导入 ${count} 条记录` : "导入记录";

      OTP.clear(previewList);

      if (!rows.length) {
        previewList.append(
          el("div", {
            class: "field-hint",
            style: { "text-align": "center", padding: "14px 0" },
            text: "粘贴数据后会自动解析预览",
          })
        );
        return;
      }

      const shown = rows.slice(0, 80);
      shown.forEach((row, index) => {
        const cls = row.kind === "bad" ? "is-bad" : row.kind === "dup" ? "is-dup" : "";
        const statusClass = row.kind === "bad" ? "is-bad" : row.kind === "dup" ? "is-dup" : "is-ok";
        const statusText = row.kind === "bad" ? "无效" : row.kind === "dup" ? "重复" : "新增";
        const primary = row.kind === "bad" ? row.reason : row.email + (row.reason ? " · " + row.reason : "");

        const item = el(
          "div",
          { class: "imp-item " + cls, style: { "animation-delay": Math.min(index, 12) * 14 + "ms" } },
          el("span", { class: "ln", text: String(row.line) }),
          el("div", { class: "em", text: primary }),
          el("span", { class: "st " + statusClass, text: statusText })
        );
        previewList.append(item);
      });

      if (rows.length > shown.length) {
        previewList.append(
          el("div", {
            class: "field-hint",
            style: { "text-align": "center", padding: "6px 0" },
            text: `仅预览前 ${shown.length} 行，共 ${rows.length} 行`,
          })
        );
      }
    }

    async function copyErrorList() {
      const bad = importState.rows.filter((row) => row.kind === "bad");
      if (!bad.length) {
        ui.toast("没有无效记录", "warn");
        return;
      }
      const text = bad.map((row) => `第 ${row.line} 行：${row.reason}`).join("\n");
      const ok = await OTP.copyText(text);
      ui.toast(ok ? `已复制 ${bad.length} 条错误说明` : "复制失败", ok ? "ok" : "bad");
    }

    function runImport() {
      const result = store.applyImport(importState.rows, importState.mode);
      if (!result.added && !result.replaced) {
        ui.toast("没有可导入的记录", "warn");
        return;
      }
      textarea.value = "";
      importState.rows = [];
      importState.text = "";
      parse();
      changed("import");
      ui.toast(
        `已导入 ${result.added} 条` + (result.replaced ? `，替换 ${result.replaced} 条` : "")
      );
    }

    textarea.addEventListener("input", OTP.debounce(parse, 200));

    // 拖放文件
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("is-over");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-over"));
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-over");
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) readFile(file);
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) readFile(file);
      fileInput.value = "";
    });

    function readFile(file) {
      if (file.size > 1024 * 1024) {
        ui.toast("文件超过 1 MiB，请拆分后再导入", "bad");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        textarea.value = String(reader.result || "").replace(/^\uFEFF/, "");
        parse();
        ui.toast("已读入文件");
      };
      reader.readAsText(file, "utf-8");
    }

    const body = el(
      "div",
      {},
      el(
        "div",
        { class: "card-box" },
        el(
          "div",
          { class: "card-head" },
          el("span", { class: "t", text: "粘贴账号数据" }),
          el("span", { class: "h", text: "邮箱----密码----密钥" })
        ),
        dropzone,
        el("div", { class: "row-btns" }, pickBtn, sampleBtn, clearBtn, el("span", { class: "spacer" }), sizeLabel),
        fileInput
      ),
      el("div", { class: "imp-stats" }, totalStat.node, freshStat.node, dupStat.node, badStat.node),
      el(
        "div",
        { class: "card-box", style: { "padding-bottom": "8px" } },
        el(
          "div",
          { class: "card-head", style: { "margin-bottom": "7px" } },
          el("span", { class: "t", text: "解析预览" }),
          copyErrors
        ),
        previewList
      )
    );

    const footer = el(
      "div",
      { style: { display: "flex", "align-items": "center", gap: "10px", width: "100%" } },
      el("span", { style: { "font-size": "var(--fs-2xs)", color: "var(--ink-3)", "white-space": "nowrap" }, text: "重复项" }),
      dupSeg.node,
      doImportBtn
    );

    parse();

    return { body, footer };
  }

  function statChip(label, value, suffix) {
    const strong = el("b", { text: value });
    return {
      node: el(
        "span",
        { class: "stat" + (label === "可新增" ? " is-new" : label === "重复" ? " is-dup" : label === "无效" ? " is-bad" : "") },
        el("span", { text: label }),
        strong,
        suffix ? el("span", { text: suffix }) : null
      ),
      value: strong,
    };
  }

  /* ==========================================================================
     设置
     ========================================================================== */

  function settingsPane() {
    const settings = store.settings();
    const security = store.securityInfo();
    const body = el("div", { class: "settings-pane" });

    /* ---- 外观 ---- */

    const themeSeg = ui.segmented({
      active: settings.theme,
      className: "seg-sm",
      items: [
        { id: "auto", label: "跟随系统" },
        { id: "light", label: "浅色" },
        { id: "dark", label: "深色" },
      ],
      onChange: (id) => {
        store.patchSettings({ theme: id });
        if (global.OTP.app && OTP.app.applyTheme) OTP.app.applyTheme(true);
      },
    });

    const colorButtons = [];
    const colorChoices = el("div", { class: "color-choices", role: "radiogroup", "aria-label": "界面色系" });
    function updateColors() {
      const current = store.settings().colorScheme;
      for (const button of colorButtons) {
        const selected = button.dataset.colorChoice === current;
        button.setAttribute("aria-checked", String(selected));
        button.tabIndex = selected ? 0 : -1;
      }
    }
    store.COLOR_SCHEMES.forEach((scheme, index) => {
      const button = el("button", {
        class: "color-choice", type: "button", role: "radio", "aria-label": scheme.label + "：" + scheme.description,
        dataset: { colorChoice: scheme.id },
        onclick: () => {
          if (store.settings().colorScheme === scheme.id) return;
          store.patchSettings({ colorScheme: scheme.id });
          updateColors();
          OTP.app.applyTheme(true);
        },
        onkeydown: event => {
          let next;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % colorButtons.length;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + colorButtons.length - 1) % colorButtons.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = colorButtons.length - 1;
          if (next !== undefined) {
            event.preventDefault(); event.stopPropagation();
            colorButtons[next].focus(); colorButtons[next].click();
          }
        },
      }, el("span", { class: "color-swatch", "aria-hidden": "true" }, el("i"), el("i"), el("i")),
      el("span", { class: "color-name", text: scheme.label }),
      el("span", { class: "color-selected", html: icon("check", 10), "aria-hidden": "true" }));
      colorButtons.push(button); colorChoices.append(button);
    });
    updateColors();
    const colorRow = el("div", { class: "color-setting" },
      el("div", { class: "color-setting-head" }, el("span", { text: "色系" }), el("span", { text: "五套配色 · 均支持浅色与深色" })), colorChoices);

    const viewSeg = ui.segmented({
      active: settings.view,
      className: "seg-sm",
      items: [
        { id: "list", label: "列表" },
        { id: "grid", label: "卡片" },
      ],
      onChange: (id) => {
        store.patchSettings({ view: id });
        changed("view");
      },
    });

    const isPageSurface = document.body.dataset.surface === "page";
    const appearanceRows = [
      setRow({
        icon: "sun",
        label: "主题",
        desc: isPageSurface ? "影响管理页与弹窗" : "影响弹窗与管理页",
        control: themeSeg.node,
      }),
      colorRow,
    ];

    // 弹窗恒为"快速复制行"，没有列表 / 卡片之分——这里不摆一个无效开关
    if (isPageSurface) {
      appearanceRows.push(
        setRow({
          icon: settings.view === "grid" ? "grid" : "list",
          label: "默认视图",
          desc: "列表适合快速扫，卡片适合手点",
          control: viewSeg.node,
        })
      );
    }

    body.append(group("外观", appearanceRows));

    /* ---- 访问门禁 ---- */

    const lockSeg = ui.segmented({
      active: String(settings.lockAfter),
      className: "seg-sm",
      items: [
        { id: "1", label: "1 分" },
        { id: "5", label: "5 分" },
        { id: "15", label: "15 分" },
        { id: "0", label: "关闭" },
      ],
      onChange: (id) => {
        store.patchSettings({ lockAfter: Number(id) });
        ui.toast(Number(id) ? `闲置 ${id} 分钟后自动锁定` : "已关闭自动锁定");
      },
    });

    const pwdDesc = security
      ? security.algorithm === "PBKDF2-SHA256"
        ? `已设置 · PBKDF2 ${Math.round(security.iterations / 1000)}k 轮加盐派生`
        : "已设置 · 当前环境缺少 Web Crypto，摘要强度较弱"
      : "尚未设置";

    let rememberBusy = false;
    const rememberToggle = el("button", { id: "remember-toggle", class: "toggle", type: "button", role: "switch",
      "aria-label": "短时免密", "aria-checked": String(!!settings.rememberMinutes), disabled: !OTP.access.available,
      onclick: () => changeRemember(store.settings().rememberMinutes ? 0 : 5) });
    const rememberSeg = ui.segmented({ active: String(settings.rememberMinutes || 5), className: "seg-sm",
      items: [{ id: "1", label: "1 分钟" }, { id: "5", label: "5 分钟" }, { id: "15", label: "15 分钟" }],
      onChange: value => changeRemember(Number(value)) });
    const rememberDuration = el("div", { class: "remember-duration", hidden: !settings.rememberMinutes },
      el("span", { text: "密码验证后有效期" }), rememberSeg.node);
    function updateRemember() {
      const minutes = store.settings().rememberMinutes;
      rememberToggle.setAttribute("aria-checked", String(!!minutes));
      rememberToggle.disabled = rememberBusy || !OTP.access.available;
      rememberDuration.hidden = !minutes;
      rememberSeg.setActive(String(minutes || 5));
    }
    async function changeRemember(next) {
      if (rememberBusy || !OTP.access.available) return;
      const previous = store.settings().rememberMinutes || 0;
      if (next === previous) return;
      rememberBusy = true; updateRemember();
      try {
        if (next > previous) {
          const ok = await ui.confirm({ title: "开启短时免密？", icon: "shield", danger: true,
            message: `验证密码后的 <b>${next} 分钟</b>内，重新打开插件无需输入密码。<br>任何能使用当前浏览器的人都可能查看或复制账号密码与验证码。<br>请仅在可信的个人设备上启用；手动锁定、修改密码或结束浏览器会话会使授权失效。`,
            confirmText: "我了解风险，开启", cancelText: "取消" });
          if (!ok) return;
        }
        store.patchSettings({ rememberMinutes: next });
        await store.persist();
        const current = await OTP.access.remember();
        ui.toast(!next ? "短时免密已关闭" : current && OTP.access.graceActive ? `已开启 ${next} 分钟免密，不随重开续期` : "已开启，下次输入密码后生效");
      } catch (_) {
        store.patchSettings({ rememberMinutes: previous });
        await store.persist().catch(() => {});
        ui.toast("设置保存失败，请重试", "bad");
      } finally { rememberBusy = false; updateRemember(); }
    }

    body.append(
      group("访问门禁", [
        setRow({
          icon: "lock",
          label: "管理密码",
          desc: pwdDesc,
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            text: security ? "修改" : "设置",
            onclick: () => openPasswordFlow(),
          }),
        }),
        setRow({
          icon: "clock",
          label: "闲置自动锁定",
          desc: "无操作达到时长后重新上锁",
          control: lockSeg.node,
        }),
        setRow({ icon: "keyhole", label: "短时免密", desc: OTP.access.available
          ? "默认关闭 · 有效期内重开免密码，且暂缓闲置锁定；手动锁定立即失效"
          : "请在实际浏览器扩展中使用，会话不写入本地磁盘", control: rememberToggle }),
        rememberDuration,
        setRow({
          icon: "keyhole",
          label: "立即锁定",
          desc: "清除内存中的明文显示状态",
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            html: icon("lock", 12, "i-sm") + "<span>锁定</span>",
            onclick: () => {
              ui.closeSheet(true);
              OTP.app.lock();
            },
          }),
        }),
      ])
    );

    /* ---- 分类 ---- */

    const catCount = store.categories().length;
    body.append(
      group("分类", [
        setRow({
          icon: "tag",
          label: "管理分类",
          desc: `${catCount} 个分类 · 只用于筛选，随备份一起导出`,
          onTap: () => openCategoryManager(),
          control: el("span", { class: "set-value", html: icon("chevron-right", 14) }),
        }),
      ])
    );

    /* ---- 数据 ---- */

    const syncAvailable = store.sync.available();
    const usage = { used: 0, quota: 102400 };
    const meterFill = el("i", { style: { width: "2%" } });
    const meterText = el("span", { class: "meter-txt", text: "0 B / 100 KB" });
    const meterRow = el("div", { class: "meter-row" }, el("div", { class: "meter" }, meterFill), meterText);
    meterRow.hidden = !settings.syncEnabled;

    const syncDesc = el("span", {
      text: syncAvailable
        ? settings.syncEnabled
          ? settings.lastSyncAt
            ? `已开启 · 上次同步 ${OTP.fmt.clockText(settings.lastSyncAt)}`
            : "已开启 · 等待首次同步"
          : "已关闭 · 数据只在本机"
        : "请在扩展中使用（本地预览不支持）",
      hidden: false,
    });

    const syncToggle = el("button", {
      class: "toggle",
      type: "button",
      role: "switch",
      "aria-checked": String(!!settings.syncEnabled),
      "aria-label": "浏览器同步",
      disabled: !syncAvailable,
      onclick: async (event) => {
        if (!syncAvailable) {
          ui.toast("这个环境里读不到 chrome.storage.sync", "warn");
          return;
        }
        const on = syncToggle.getAttribute("aria-checked") === "true";
        syncToggle.disabled = true;
        try {
          if (on) {
            await store.sync.disable();
            syncToggle.setAttribute("aria-checked", "false");
            syncDesc.textContent = "已关闭 · 数据只在本机";
            meterRow.hidden = true;
            ui.toast("已关闭同步");
          } else {
            syncToggle.setAttribute("aria-checked", "true");
            syncDesc.textContent = "正在同步…";
            const result = await store.sync.enable();
            syncDesc.textContent = `已开启 · 上次同步 ${OTP.fmt.clockText(Date.now())} · 拉取 ${result.pulled} 条`;
            meterRow.hidden = false;
            await updateUsage();
            changed("sync");
            showSyncResult(result);
          }
        } catch (err) {
          syncToggle.setAttribute("aria-checked", String(!!store.settings().syncEnabled));
          syncDesc.textContent = "同步失败 · " + (err.message || "未知原因");
          ui.toast("同步失败：" + (err.message || "未知原因"), "bad");
        } finally {
          syncToggle.disabled = !syncAvailable;
        }
      },
    });

    async function updateUsage() {
      if (!store.sync.available()) {
        meterText.textContent = "不可用";
        return;
      }
      const info = await store.sync.usage();
      usage.used = info.used;
      usage.quota = info.quota;
      const pct = OTP.clamp((info.used / info.quota) * 100, 1.5, 100);
      meterFill.style.width = pct.toFixed(1) + "%";
      if (info.error) { meterText.textContent = "容量读取失败：" + info.error; return; }
      meterText.textContent = `${OTP.fmt.bytes(info.used)} / ${Math.round(info.quota / 1024)} KB`;
    }
    updateUsage();

    const syncRow = setRow({
      icon: "sync",
      label: "浏览器同步",
      descNode: [syncDesc, meterRow],
      control: syncToggle,
    });

    const syncNowButton = el("button", {
      class: "btn btn-ghost btn-xs", type: "button", text: "立即同步",
      onclick: async () => {
        syncNowButton.disabled = true;
        const result = await store.sync.now();
        showSyncResult(result);
        updateSyncState();
        updateUsage();
      },
    });
    function showSyncResult(result) {
      if (!result.ok) { ui.toast(result.error, "bad"); return; }
      if (result.remoteAccounts === 0 && result.localAccounts === 0) {
        ui.toast("当前扩展 ID 的同步缓存没有账号，请检查旧版 ID 或浏览器账号同步", "warn", { duration: 6500 });
      } else ui.toast(`同步存储已合并 · 读取 ${result.pulled} 条，提交 ${result.pushed} 条`);
    }
    const diagnosticBox = el("div", { class: "sync-help", id: "sync-diagnostics", hidden: true, role: "status" });
    const inspectButton = el("button", { class: "btn btn-ghost btn-xs", type: "button", id: "sync-inspect", text: "只读检查",
      disabled: !syncAvailable, onclick: async () => {
        inspectButton.disabled = true;
        try {
          const report = await store.sync.inspect();
          diagnosticBox.replaceChildren(); diagnosticBox.hidden = false;
          if (!report.ok) { diagnosticBox.append(el("p", { text: report.error })); return; }
          diagnosticBox.append(el("code", { text: "当前扩展 ID：" + report.extensionId }),
            el("p", { text: `本机账号 ${report.localAccounts} 条 · 当前同步缓存账号 ${report.cachedAccounts} 条 · 分类 ${report.cachedCategories} 条` }),
            el("p", { text: report.cachedAccounts ? "此处是当前浏览器已收到的同步缓存，不能证明其他设备已收到。" : "这个 ID 的同步缓存为空。若升级时删除旧扩展并改用新目录，旧数据属于另一个 ID。" }),
            el("p", { text: "此检查不会修改本机或同步记录，也无法读取其他扩展 ID 的空间。" }));
        } finally { inspectButton.disabled = !syncAvailable; }
      } });
    function updateSyncState() {
      const info = store.sync.info();
      syncToggle.setAttribute("aria-checked", String(info.enabled));
      syncNowButton.disabled = !info.available || !info.enabled || info.busy;
      syncNowButton.textContent = info.busy ? "同步中…" : info.error ? "重试同步" : "立即同步";
      meterRow.hidden = !info.enabled;
      syncDesc.textContent = !info.available ? "请在扩展中使用（本地预览不支持）"
        : !info.enabled ? "已关闭 · 数据只在本机"
        : info.busy ? "正在与浏览器同步存储合并…"
        : info.error ? "同步失败 · " + info.error
        : info.lastResult?.remoteAccounts === 0 && info.lastResult?.localAccounts === 0 ? "当前同步缓存没有账号 · 请核对扩展 ID"
        : info.lastSyncAt ? "上次合并 " + OTP.fmt.clockText(info.lastSyncAt) : "等待首次同步";
    }
    updateSyncState();
    const unsubscribe = store.subscribe((reason) => {
      if (reason.startsWith("sync") || reason.includes("settings")) updateSyncState();
      if (reason.includes("settings")) { updateColors(); themeSeg.setActive(store.settings().theme); updateRemember(); }
    });
    const stats = store.stats();

    body.append(
      group("同步与备份", [
        syncRow,
        setRow({ icon: "refresh", label: "同步状态", desc: "自动合并账号、分类与删除记录", control: syncNowButton }),
        setRow({ icon: "info", label: "同步诊断", desc: "检查当前扩展 ID、本机和同步缓存条数", control: inspectButton }),
        diagnosticBox,
        el("p", { class: "field-hint", text: "同一种浏览器登录同一账号，并开启扩展同步；两台设备需使用同一扩展 ID。浏览器决定云端传输时间，完成本地合并不等于另一台设备已收到。" }),
        el("p", { class: "field-hint", text: "开启后，账号密码与 TOTP 密钥将写入浏览器同步存储，未做端到端加密；管理密码不上云。" }),
        el("details", { class: "sync-help" },
          el("summary", { text: "另一台浏览器如何拉取？" }),
          el("ol", {},
            el("li", { text: "源浏览器登录账号，并同时开启浏览器同步和本扩展的浏览器同步，然后点击立即同步。" }),
            el("li", { text: "目标设备使用同一种浏览器、同一浏览器账号、同一扩展 ID。首次打开先设置该设备的管理密码。" }),
            el("li", { text: "目标扩展开启浏览器同步，再点击立即同步。浏览器送达的云端记录会自动合并到本地，不需要手动导入。" })),
          el("p", { text: "Edge 与 Chrome 的云端不互通。浏览器未登录或关闭自身同步时，同步存储可能只保存在本机；插件无法强制云端立即送达。" }),
          el("p", { text: "解压加载到不同路径可能产生不同扩展 ID。两端 ID 不同时可用导出/导入备份迁移。" }),
          el("code", { text: "本机扩展 ID：" + (global.chrome?.runtime?.id || "本地预览，无扩展 ID") })),
        setRow({
          icon: "download",
          label: "导出备份",
          desc: `UTF-8 JSON · ${stats.count} 个账号 · 含密码与密钥`,
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            html: icon("download", 12, "i-sm") + "<span>导出</span>",
            onclick: () => OTP.app.exportBackup(),
          }),
        }),
        setRow({
          icon: "upload",
          label: "导入备份",
          desc: "按邮箱合并，不覆盖已有记录",
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            html: icon("upload", 12, "i-sm") + "<span>导入</span>",
            onclick: () => OTP.app.importBackup(),
          }),
        }),
      ])
    );

    /* ---- 地址栏入口 ---- */
    const entryUrl = new URL("api.html", location.href).href;
    body.append(group("临时验证码与地址栏 API", [
      el("div", { class: "entry-setting" },
        el("p", { text: "地址栏输入 otp，按 Tab 或空格进入 LocalOTP，然后粘贴密钥并回车。也可打开独立页面，直接粘贴密钥或 otpauth 链接。" }),
        el("div", { class: "entry-code", text: entryUrl + "#otp=YOUR_BASE32_SECRET" }),
        el("p", { text: "支持 algorithm、digits、period 参数。临时密钥不进入账号库；地址栏输入可能留在浏览器历史，敏感密钥建议在页面输入框中填写。" }),
        el("div", { class: "entry-actions" },
          el("a", { class: "btn btn-ghost btn-xs", href: entryUrl, target: "_blank", rel: "noopener", text: "打开验证码页面" }),
          el("button", { class: "btn btn-ghost btn-xs", type: "button", text: "复制入口地址", onclick: async () => {
            const ok = await OTP.copyText(entryUrl + "#otp=");
            ui.toast(ok ? "入口地址已复制" : "复制失败，请手动选择地址", ok ? "ok" : "bad");
          } })
        )
      )
    ]));

    /* ---- 危险区 ---- */

    body.append(
      group("本机数据", [
        setRow({
          icon: "history",
          label: "恢复演示数据",
          desc: "覆盖当前账号列表，回到初始的 10 条示例",
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            text: "恢复",
            onclick: async () => {
              const ok = await ui.confirm({
                title: "恢复演示数据？",
                message: "当前全部账号会被替换成 10 条示例记录，此操作不可撤销。",
                confirmText: "覆盖",
                danger: true,
              });
              if (!ok) return;
              store.resetDemo();
              changed("reset");
              ui.toast("演示数据已恢复", "warn");
            },
          }),
        }),
        setRow({
          icon: "trash",
          label: "清空本机数据",
          desc: "删除全部账号与分类，管理密码也会一并清除",
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            html: icon("trash", 12, "i-sm") + "<span>清空</span>",
            style: { color: "var(--danger)" },
            onclick: async () => {
              const ok = await ui.confirm({
                title: "清空全部本机数据？",
                message:
                  "账号、分类与管理密码都会被删除，且无法恢复。若需要保留，请先导出备份。",
                confirmText: "全部清空",
                danger: true,
                icon: "trash",
              });
              if (!ok) return;
              await store.wipe();
              ui.closeSheet(true);
              OTP.app.relockAfterWipe();
            },
          }),
        }),
      ])
    );

    body.append(
      el(
        "div",
        { class: "note" },
        el("span", { html: icon("shield", 13) }),
        el("div", {}, "账号密码与 TOTP 密钥以未加密形式保存在扩展存储中，管理密码只用于阻止他人随手查看，不参与任何加密。")
      )
    );

    body.append(
      el("p", {
        class: "sheet-footnote",
        text: "LocalOTP 1.6.1 · 本地存储 / 可选浏览器同步",
      })
    );

    return { body, footer: null, dispose: unsubscribe };
  }

  /* ==========================================================================
     管理抽屉（导入 / 设置）
     ========================================================================== */

  let manageTab = "import";

  function subtitleFor(id) {
    return id === "import" ? "粘贴账号数据，或从文件导入" : "外观、门禁、同步与备份";
  }

  function openManage(tab) {
    const panes = { import: null, settings: null };
    let current = tab === "settings" ? "settings" : "import";
    manageTab = current;

    const paneHost = el("div", {});
    const tabs = ui.segmented({
      active: current,
      items: [
        { id: "import", label: "批量导入" },
        { id: "settings", label: "设置" },
      ],
      onChange: (id) => show(id),
    });

    function paneFor(id) {
      if (!panes[id]) panes[id] = id === "import" ? importPane() : settingsPane();
      return panes[id];
    }

    function applyFooter(pane) {
      const foot = ui.refs.sheetFoot;
      OTP.clear(foot);
      if (pane.footer) {
        foot.append(pane.footer);
        foot.hidden = false;
      } else {
        foot.hidden = true;
      }
    }

    function show(id) {
      current = id;
      manageTab = id;
      const pane = paneFor(id);

      OTP.clear(paneHost);
      paneHost.append(pane.body);

      // 抽屉已经打开：只换副标题、页脚与滚动位置，不做整块重排
      ui.refs.sheetSub.textContent = subtitleFor(id);
      ui.refs.sheetSub.hidden = false;
      ui.refs.sheetBody.scrollTop = 0;
      applyFooter(pane);
      if (tabs.value !== id) tabs.setActive(id);
    }

    const container = el("div", {}, el("div", { class: "sheet-tabs" }, tabs.node), paneHost);

    // 先把首屏内容装好，再一次性打开抽屉，页脚不会闪一下空
    const first = paneFor(current);
    paneHost.append(first.body);

    ui.openSheet({
      title: "管理",
      subtitle: subtitleFor(current),
      body: container,
      footer: first.footer || null,
      onClose: () => Object.values(panes).forEach((pane) => pane?.dispose?.()),
    });
  }

  /* ==========================================================================
     修改 / 设置管理密码
     ========================================================================== */

  function openPasswordFlow() {
    const hasPwd = store.hasPassword();

    const currentInput = el("input", {
      type: "password",
      placeholder: "当前管理密码",
      autocomplete: "current-password",
    });
    const newInput = el("input", {
      type: "password",
      placeholder: hasPwd ? "新的管理密码" : "设置管理密码（至少 4 位）",
      autocomplete: "new-password",
    });
    const confirmInput = el("input", {
      type: "password",
      placeholder: "再次输入确认",
      autocomplete: "new-password",
    });

    const bars = el("div", { class: "strength-bars" }, el("i"), el("i"), el("i"));
    const strengthLabel = el("span", { class: "strength-label", text: "" });
    const strength = el("div", { class: "strength", dataset: { level: "0" } }, bars, strengthLabel);

    function levelOf(value) {
      if (!value) return 0;
      let score = 0;
      if (value.length >= 4) score += 1;
      if (value.length >= 8) score += 1;
      if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
      if (/\d/.test(value)) score += 1;
      if (/[^\w\s]/.test(value)) score += 1;
      return Math.min(3, Math.max(1, Math.round(score * 0.6)));
    }

    newInput.addEventListener("input", () => {
      const level = levelOf(newInput.value);
      strength.dataset.level = String(level);
      strengthLabel.textContent = level === 0 ? "" : level === 1 ? "弱" : level === 2 ? "中" : "强";
    });

    const currentField = hasPwd
      ? field("当前密码", currentInput, { required: true, error: "当前密码不正确" })
      : null;
    const newField = field(hasPwd ? "新密码" : "设置密码", newInput, {
      required: true,
      error: "至少 4 位",
      hint: "只用于界面解锁，不会加密任何数据；忘记后只能清空本机数据重新导入备份",
    });
    const confirmField = field("确认新密码", confirmInput, { required: true, error: "两次输入不一致" });

    newField.node.append(strength);

    const body = el("div", { class: "form" }, currentField ? currentField.node : null, newField.node, confirmField.node);

    const submitBtn = el("button", {
      class: "btn btn-primary",
      type: "button",
      text: hasPwd ? "保存新密码" : "保存并启用",
      onclick: submit,
    });

    async function submit() {
      const current = currentInput.value;
      const next = newInput.value;
      const again = confirmInput.value;
      let bad = false;

      if (hasPwd) {
        const ok = await store.verifyPassword(current);
        currentField.setError(ok ? "" : "当前密码不正确");
        bad = bad || !ok;
      }
      if (next.length < 4) {
        newField.setError("至少 4 位");
        bad = true;
      } else {
        newField.setError("");
      }
      if (next !== again) {
        confirmField.setError("两次输入不一致");
        bad = true;
      } else {
        confirmField.setError("");
      }

      if (bad) return;

      submitBtn.disabled = true;
      submitBtn.textContent = "正在保存…";
      await store.setPassword(next);
      ui.closeSheet(true);
      ui.toast(hasPwd ? "管理密码已更新" : "管理密码已设置");
      changed("password");
    }

    for (const input of [currentInput, newInput, confirmInput]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      });
    }

    ui.openSheet({
      title: hasPwd ? "修改管理密码" : "设置管理密码",
      subtitle: hasPwd ? "需要先验证当前密码" : "之后每次打开都需要输入",
      body,
      footer: submitBtn,
    });
  }

  /* ==========================================================================
     分类管理
     ========================================================================== */

  const ICON_LABELS = {
    briefcase: "工作",
    gamepad: "游戏",
    cart: "购物",
    code: "开发",
    cloud: "云服务",
    bank: "金融",
    mail: "邮箱",
    tag: "标签",
    star: "常用",
    users: "团队",
    folder: "文件夹",
    shield: "安全",
  };

  function openCategoryManager() {
    const list = el("div", { class: "cat-manager" });

    function paint() {
      OTP.clear(list);
      const cats = store.categories();
      if (!cats.length) {
        list.append(
          el("p", { class: "field-hint", style: { "text-align": "center", padding: "16px 0" }, text: "还没有分类" })
        );
      }
      for (const cat of cats) {
        const count = store.accounts().filter((a) => a.categoryId === cat.id).length;
        list.append(
          el(
            "div",
            { class: "cat-row-item" },
            el("span", { class: "set-ico", html: icon(cat.icon, 15) }),
            el("span", { class: "cat-label" }, el("b", { text: cat.name })),
            el("span", { class: "set-value", text: count + " 个" }),
            el("button", {
              class: "ibtn ibtn-sm",
              type: "button",
              "aria-label": "编辑分类",
              html: icon("edit", 14, "i-sm"),
              onclick: () => openCategoryEditor(cat, openCategoryManager),
            }),
            el("button", {
              class: "ibtn ibtn-sm ibtn-danger",
              type: "button",
              "aria-label": "删除分类",
              html: icon("trash", 14, "i-sm"),
              onclick: async () => {
                const ok = await ui.confirm({
                  title: "删除分类？",
                  message: "分类里的账号会移回「未分类」，账号本身不会被删除。",
                  confirmText: "删除分类",
                  danger: true,
                });
                if (!ok) return;
                store.deleteCategory(cat.id);
                paint();
                changed("category");
                ui.toast("分类已删除", "warn");
              },
            })
          )
        );
      }
    }

    paint();

    const addBtn = el("button", {
      class: "btn btn-primary",
      type: "button",
      html: icon("plus", 14, "i-sm") + "<span>新增分类</span>",
      onclick: () => openCategoryEditor(null, openCategoryManager),
    });
    const backBtn = el("button", {
      class: "btn btn-ghost",
      type: "button",
      text: "返回",
      onclick: () => openManage(manageTab),
    });

    ui.openSheet({
      title: "管理分类",
      subtitle: "分类只用于筛选，随备份一起导出",
      body: list,
      footer: [backBtn, addBtn],
    });
  }

  function openCategoryEditor(category, onDone) {
    let selected = category ? category.icon : "folder";
    const isEdit = !!category;

    const nameInput = el("input", {
      type: "text",
      maxlength: "16",
      placeholder: "例如：工作、游戏、邮箱",
      value: category ? category.name : "",
    });
    const nameField = field("分类名称", nameInput, { required: true });

    const grid = el("div", { class: "icon-grid", role: "group", "aria-label": "分类图标" });
    const buttons = [];

    for (const key of store.CATEGORY_ICONS) {
      const btn = el("button", {
        class: "icon-option" + (key === selected ? " is-on" : ""),
        type: "button",
        "aria-label": ICON_LABELS[key] || key,
        "aria-pressed": String(key === selected),
        "data-tip": ICON_LABELS[key] || key,
        html: icon(key, 20),
        onclick: () => {
          selected = key;
          for (const other of buttons) {
            other.classList.toggle("is-on", other === btn);
            other.setAttribute("aria-pressed", String(other === btn));
          }
        },
      });
      buttons.push(btn);
      grid.append(btn);
    }

    const body = el("div", { class: "form" }, nameField.node, el("div", { class: "field-label", text: "图标" }), grid);

    const save = el("button", {
      class: "btn btn-primary",
      type: "button",
      text: isEdit ? "保存分类" : "创建分类",
      onclick: () => {
        try {
          store.saveCategory({ id: category ? category.id : "", name: nameInput.value, icon: selected });
          changed("category");
          if (onDone) onDone();
          ui.toast(isEdit ? "分类已保存" : "分类已创建");
        } catch (err) {
          nameField.setError(err.message);
        }
      },
    });

    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save.click();
      }
    });

    const cancel = el("button", {
      class: "btn btn-ghost",
      type: "button",
      text: "取消",
      onclick: () => (onDone ? onDone() : ui.closeSheet(true)),
    });

    ui.openSheet({
      title: isEdit ? "编辑分类" : "新增分类",
      subtitle: "挑一个图标，给账号分个家",
      body,
      footer: [cancel, save],
    });
  }

  /* ── 对外 ─────────────────────────────────────────────────────────────── */

  OTP.sheets = {
    setOnChanged,
    openEditor,
    openQuickAdd,
    openManage,
    openSettings: () => openManage("settings"),
    openImport: () => openManage("import"),
    openPasswordFlow,
    openCategoryManager,
    randomPassword,
  };
})(window);
