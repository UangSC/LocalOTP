/* 管理密码设置。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { field, changed } = OTP.sheetUI;
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

  /* 分类管理 */


  Object.assign(OTP.sheetParts, { openPasswordFlow });
})(globalThis);
