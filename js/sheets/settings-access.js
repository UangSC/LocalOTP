/* 访问控制设置。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { group, setRow, changed } = OTP.sheetUI;
  OTP.sheetParts.accessSettings = function () {
    const settings = store.settings(), security = store.securityInfo();
    const body = document.createDocumentFragment();
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
            onclick: () => OTP.sheets.openPasswordFlow(),
          }),
        }),
        setRow({
          icon: "clock",
          label: "闲置自动锁定",
          desc: "无操作达到时长后重新上锁",
          control: lockSeg.node,
        }),
        setRow({ icon: "keyhole", label: "短时免密", desc: OTP.access.available
          ? "默认关闭 · 有效期内重开免密码，且暂缓闲置锁定"
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
          onTap: () => OTP.sheets.openCategoryManager(),
          control: el("span", { class: "set-value", html: icon("chevron-right", 14) }),
        }),
      ])
    );


    return {body, refresh() { updateRemember(); }};
  };
})(globalThis);
