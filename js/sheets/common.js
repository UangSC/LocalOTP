/* 表单共享控件与变更通知。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  const { el, icon } = OTP;
  let onChangedCallback = null;

  function setOnChanged(fn) {
    onChangedCallback = fn;
  }

  function changed(reason) {
    if (onChangedCallback) onChangedCallback(reason);
  }

  /* 账号编辑 */

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

  /* 设置面板的零件 */

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

  /* 批量导入 */

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

  /* 设置 */


  OTP.sheetUI = { field, advRow, randomPassword, group, setRow, statChip, changed, setOnChanged };
  OTP.sheetParts = {};
})(globalThis);
