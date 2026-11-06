/* 管理抽屉入口；具体表单位于 sheets/。 */
(function (global) {
  "use strict";
  const OTP=global.OTP, ui=OTP.ui;
  const {el}=OTP;
  const {setOnChanged,randomPassword}=OTP.sheetUI;
  const {openEditor,openQuickAdd,importPane,settingsPane,openPasswordFlow,openCategoryManager}=OTP.sheetParts;

  function subtitleFor(id) {
    return id === "import" ? "粘贴账号数据，或从文件导入" : "外观、门禁、同步与备份";
  }

  function openManage(tab) {
    const panes = { import: null, settings: null };
    let current = tab === "settings" ? "settings" : "import";


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

  /* 修改 / 设置管理密码 */

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

})(globalThis);
