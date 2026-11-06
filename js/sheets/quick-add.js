/* 快速添加表单。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { field, changed } = OTP.sheetUI;
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

  /* 表单零件 */


  Object.assign(OTP.sheetParts, { openQuickAdd });
})(globalThis);
