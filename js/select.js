/* 自定义单选下拉：焦点留在触发器，弹层独立定位，不受抽屉滚动裁切。 */
(function (global) {
  "use strict";
  const { el, icon, ui } = global.OTP;
  let active = null;
  let sequence = 0;
  ui.closeSelect = () => active?.close();
  ui.select = function ({ label, value = "", items }) {
    const id = "select-options-" + ++sequence;
    let selected = Math.max(0, items.findIndex(item => item.value === value));
    let highlighted = selected;
    let popup = null;
    let options = [];
    let search = "", searchTime = 0;
    const badge = el("span", { class: "select-badge", "aria-hidden": "true" });
    const text = el("span", { class: "select-value" });
    const trigger = el("button", {
      class: "select-trigger", type: "button", role: "combobox", "aria-label": label,
      "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": id,
    }, badge, text, el("span", { class: "select-chevron", html: icon("chevron-down", 15), "aria-hidden": "true" }));
    function update() {
      trigger.value = items[selected].value;
      text.textContent = items[selected].label;
      badge.innerHTML = icon(items[selected].icon || "folder", 15);
    }
    function position() {
      if (!popup || !trigger.isConnected) { close(); return; }
      const host = ui.refs.app.getBoundingClientRect();
      const anchor = trigger.closest(".field-input").getBoundingClientRect();
      const topLimit = Math.max(host.top, 0) + 8;
      const bottomLimit = Math.min(host.bottom, innerHeight) - 8;
      if (anchor.bottom < topLimit || anchor.top > bottomLimit || !anchor.height) { close(); return; }
      const below = bottomLimit - anchor.bottom - 7;
      const above = anchor.top - topLimit - 7;
      const desired = Math.min(336, 42 + items.length * 39 + 12);
      const up = below < desired && above > below;
      popup.dataset.side = up ? "top" : "bottom";
      popup.style.width = Math.min(anchor.width, host.width - 16) + "px";
      popup.style.maxHeight = Math.max(40, Math.min(desired, up ? above : below)) + "px";
      popup.style.left = Math.max(8, Math.min(anchor.left - host.left, host.width - popup.offsetWidth - 8)) + "px";
      popup.style.top = (up ? anchor.top - host.top - popup.offsetHeight - 7 : anchor.bottom - host.top + 7) + "px";
    }
    function highlight(index) {
      highlighted = (index + items.length) % items.length;
      options.forEach((node, i) => node.classList.toggle("is-active", i === highlighted));
      trigger.setAttribute("aria-activedescendant", id + "-" + highlighted);
      // 只滚动选项列表。scrollIntoView 会连带滚动整页，使全局 scroll 监听立即关掉菜单。
      const option = options[highlighted];
      const list = option?.parentElement;
      if (list) {
        const top = option.offsetTop - list.offsetTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + option.offsetHeight - list.clientHeight;
      }
    }
    function close() {
      if (!popup) return;
      popup.remove(); popup = null; options = [];
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      trigger.closest(".field-input")?.classList.remove("has-select-open");
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scroll, true);
      global.removeEventListener("resize", position);
      if (active?.trigger === trigger) active = null;
    }
    function choose(index) {
      const changed = selected !== index;
      selected = index; update(); close();
      trigger.focus({ preventScroll: true });
      if (changed) trigger.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function outside(event) {
      if (!popup?.contains(event.target) && !trigger.contains(event.target)) close();
    }
    // 自动定位焦点可能在 click 之后才派发外层 scroll；重定位而不是关闭刚打开的菜单。
    function scroll(event) { if (popup && !popup.contains(event.target)) position(); }
    function open() {
      if (popup || trigger.disabled) return;
      ui.closeSelect(); ui.closeMenu(); ui.hideTip();
      highlighted = selected; search = "";
      const list = el("div", { class: "select-options scroller", role: "listbox", id, "aria-label": label });
      options = items.map((item, i) => el("div", {
        class: "select-option" + (i === selected ? " is-selected" : ""),
        role: "option", id: id + "-" + i, "aria-selected": String(i === selected),
        onpointermove: () => { if (highlighted !== i) highlight(i); },
        onpointerdown: event => event.preventDefault(),
        onclick: () => choose(i),
      }, el("span", { class: "select-option-icon", html: icon(item.icon || "folder", 15), "aria-hidden": "true" }),
      el("span", { class: "select-option-label", text: item.label }),
      el("span", { class: "select-check", html: icon("check", 14), "aria-hidden": "true" })));
      list.append(...options);
      popup = el("div", { class: "select-popup" },
        el("div", { class: "select-heading", "aria-hidden": "true" }, el("span", { text: "选择" + label }), el("span", { text: items.length + " 项" })), list);
      ui.refs.app.append(popup);
      active = { trigger, close };
      trigger.setAttribute("aria-expanded", "true");
      trigger.closest(".field-input").classList.add("has-select-open");
      position(); highlight(selected);
      if (!global.OTP.reduceMotion()) popup.animate([
        { opacity: 0, transform: `translateY(${popup.dataset.side === "top" ? 5 : -5}px) scale(.98)` },
        { opacity: 1, transform: "none" },
      ], { duration: 200, easing: "cubic-bezier(.16,1,.3,1)" });
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("scroll", scroll, true);
      global.addEventListener("resize", position);
    }
    trigger.addEventListener("click", () => popup ? close() : open());
    trigger.addEventListener("blur", close);
    trigger.addEventListener("keydown", event => {
      const key = event.key;
      if (key === "Tab") { close(); return; }
      if (key === "Escape" && popup) { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key)) {
        event.preventDefault(); event.stopPropagation();
        if (!popup) { open(); if (key === "Home") highlight(0); if (key === "End") highlight(items.length - 1); return; }
        if (key === "Enter" || key === " ") choose(highlighted);
        else highlight(key === "Home" ? 0 : key === "End" ? items.length - 1 : highlighted + (key === "ArrowDown" ? 1 : -1));
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopPropagation();
        if (!popup) open();
        const now = Date.now(); search = now - searchTime > 700 ? key : search + key; searchTime = now;
        const index = items.findIndex(item => item.label.toLowerCase().startsWith(search.toLowerCase()));
        if (index >= 0) highlight(index);
      }
    });
    update();
    // 外部参数回填只更新选中状态，不触发用户 change 事件。
    trigger.setValue = value => {
      const index = items.findIndex(item => item.value === value);
      if (index < 0) return false;
      selected = index; update(); close(); return true;
    };
    return trigger;
  };
})(window);
