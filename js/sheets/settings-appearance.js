/* 外观设置。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { group, setRow, changed } = OTP.sheetUI;
  OTP.sheetParts.appearanceSettings = function () {
    const settings = store.settings();
    const body = document.createDocumentFragment();
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
        const patch = { theme: id };
        if (id === "light" || id === "dark") {
          patch.colorScheme = store.pairColorForTheme(store.settings().colorScheme, id);
        }
        store.patchSettings(patch);
        updateColors();
        if (global.OTP.app && OTP.app.applyTheme) OTP.app.applyTheme(true);
      },
    });

    const colorButtons = [];
    const lightChoices = el("div", { class: "color-choices", role: "group", "aria-label": "浅色双色渐变主题" });
    const darkChoices = el("div", { class: "color-choices", role: "group", "aria-label": "深色双色渐变主题" });
    const colorGroupWrap = el("div", { class: "color-groups", role: "radiogroup", "aria-label": "双色渐变主题" });

    function activeSchemeId() {
      const cur = store.settings();
      if (cur.theme === "light" || cur.theme === "dark") {
        return store.pairColorForTheme(cur.colorScheme, cur.theme);
      }
      const resolved = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      return store.pairColorForTheme(cur.colorScheme, resolved);
    }

    function updateColors() {
      const current = activeSchemeId();
      for (const button of colorButtons) {
        const selected = button.dataset.colorChoice === current;
        button.setAttribute("aria-checked", String(selected));
        button.tabIndex = selected ? 0 : -1;
      }
    }

    store.COLOR_SCHEMES.forEach((scheme, index) => {
      const button = el(
        "button",
        {
          class: "color-choice",
          type: "button",
          role: "radio",
          "aria-label": scheme.label + "：" + scheme.description,
          dataset: { colorChoice: scheme.id, colorMode: scheme.mode },
          onclick: () => {
            store.patchSettings({ theme: scheme.mode, colorScheme: scheme.id });
            themeSeg.setActive(scheme.mode);
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
        },
        el("span", { class: "color-swatch", "aria-hidden": "true" }, el("i"), el("i")),
        el("span", { class: "color-name", text: scheme.label }),
        el("span", { class: "color-selected", html: icon("check", 10), "aria-hidden": "true" })
      );
      colorButtons.push(button);
      (scheme.mode === "dark" ? darkChoices : lightChoices).append(button);
    });
    updateColors();

    colorGroupWrap.append(
      el("div", { class: "color-group-label" }, el("span", { html: icon("sun", 11) }), el("span", { text: "浅色渐变" })),
      lightChoices,
      el("div", { class: "color-group-label" }, el("span", { html: icon("moon", 11) }), el("span", { text: "深色渐变" })),
      darkChoices
    );

    const colorRow = el(
      "div",
      { class: "color-setting" },
      el("div", { class: "color-setting-head" }, el("span", { text: "双色渐变主题" }), el("span", { text: "明暗各 3 组 · 联动管理页背景" })),
      colorGroupWrap
    );

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


    return {body, refresh() { updateColors(); themeSeg.setActive(store.settings().theme); }, dispose() { themeSeg.destroy(); viewSeg.destroy(); }};
  };
})(globalThis);
