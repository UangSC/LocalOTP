/* 分类管理表单。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { field, group, changed } = OTP.sheetUI;
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
    ...OTP.brandIconLabels,
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
      onclick: () => OTP.sheets.openManage("settings"),
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

    const buttons = [];
    function makeIconGrid(keys, label) {
      const grid = el("div", { class: "icon-grid", role: "group", "aria-label": label });
      for (const key of keys) {
        const btn = el("button", {
          class: "icon-option" + (key === selected ? " is-on" : ""),
          type: "button",
          "aria-label": ICON_LABELS[key] || key,
          "aria-pressed": String(key === selected),
          "data-tip": ICON_LABELS[key] || key,
          "data-icon": key,
          title: ICON_LABELS[key] || key,
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
      return grid;
    }

    const generalIcons = store.CATEGORY_ICONS.filter(key => !OTP.brandIconLabels[key]);
    const platformIcons = store.CATEGORY_ICONS.filter(key => OTP.brandIconLabels[key]);
    const body = el("div", { class: "form" }, nameField.node,
      el("div", { class: "field-label", text: "通用图标" }), makeIconGrid(generalIcons, "通用分类图标"),
      el("div", { class: "field-label", text: "常见平台" }), makeIconGrid(platformIcons, "常见平台图标"));

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


  Object.assign(OTP.sheetParts, { openCategoryManager });
})(globalThis);
