/* 密码验证、免密期限与闲置锁定；偏好只作用于本机。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { group, setRow } = OTP.sheetUI;
  OTP.sheetParts.accessSettings = function () {
    let busy = false;
    const settings = store.settings();
    const status = el("p", { class: "access-summary", role: "status" });
    const permanent = el("button", { id: "password-disabled-toggle", class: "toggle", type: "button", role: "switch",
      "aria-label": "永久关闭密码验证", onclick: changePermanent });
    const remember = ui.segmented({ active: String(settings.rememberMinutes), className: "seg-sm",
      items: [{ id: "1", label: "1 分" }, { id: "5", label: "5 分" }, { id: "15", label: "15 分" }, { id: "0", label: "每次验证" }],
      onChange: value => saveRemember(Number(value)) });
    remember.node.id = "remember-duration";
    const idle = ui.segmented({ active: String(settings.lockAfter), className: "seg-sm",
      items: [{ id: "1", label: "1 分" }, { id: "5", label: "5 分" }, { id: "15", label: "15 分" }, { id: "0", label: "关闭" }],
      onChange: value => {
        if (busy || store.settings().passwordRequired === false) return;
        store.patchSettings({ lockAfter: Number(value) });
        ui.toast(Number(value) ? `闲置 ${value} 分钟后锁定（免密期结束后生效）` : "已关闭闲置自动锁定");
      } });
    const timing = el("div", { class: "access-timing" },
      setRow({ icon: "clock", label: "重开免密时长", desc: "从输入密码起计时，重开不会延长 · 默认 15 分钟", control: remember.node }),
      setRow({ icon: "lock", label: "闲置自动锁定", desc: "免密期结束后，按无操作时间锁定", control: idle.node }));
    const lockButton = el("button", { class: "btn btn-ghost btn-xs", type: "button", onclick: () => { ui.closeSheet(true); OTP.app.lock(); } });
    function refresh() {
      const s = store.settings(), off = s.passwordRequired === false;
      permanent.setAttribute("aria-checked", String(off));
      permanent.disabled = busy;
      timing.hidden = off;
      timing.inert = busy;
      remember.setActive(String(s.rememberMinutes));
      idle.setActive(String(s.lockAfter));
      status.textContent = off ? "永久免密码已开启 · 重启浏览器后仍可直接进入" : s.rememberMinutes
        ? `验证一次，${s.rememberMinutes} 分钟内重开无需密码 · 浏览器重启后重新验证` : "每次重新打开均验证密码 · 已打开的页面按闲置设置锁定";
      lockButton.innerHTML = icon("lock", 12) + `<span>${off ? "恢复验证并锁定" : "立即锁定"}</span>`;
    }
    async function saveRemember(next) {
      if (busy || store.settings().passwordRequired === false) return;
      const previous = store.settings().rememberMinutes;
      busy = true; refresh();
      try {
        store.patchSettings({ rememberMinutes: next });
        await store.persist();
        if (OTP.access.available) await OTP.access.remember();
        ui.toast(next ? `已设为 ${next} 分钟免密` : "已设为每次验证");
      } catch (_) {
        store.patchSettings({ rememberMinutes: previous });
        await store.persist().catch(() => {});
        ui.toast("设置保存失败，请重新解锁后重试", "bad");
      } finally { busy = false; refresh(); }
    }
    async function changePermanent() {
      if (busy) return;
      const off = store.settings().passwordRequired !== false;
      busy = true; refresh();
      try {
        if (off && !await ui.confirm({ title: "永久关闭密码验证？", icon: "shield", danger: true,
          message: "开启后，任何能使用当前浏览器的人都能查看账号、密码和验证码，重启浏览器也无需验证。<br>已有管理密码会保留，便于随时恢复验证。",
          confirmText: "关闭密码验证" })) return;
        store.patchSettings({ passwordRequired: !off });
        await store.persist();
        if (off) {
          if (OTP.access.available && !await OTP.access.restore()) throw new Error("授权失败");
          ui.toast("已开启永久免密码");
        } else {
          ui.closeSheet(true);
          await OTP.app.lock();
        }
      } catch (_) {
        store.patchSettings({ passwordRequired: off });
        await store.persist().catch(() => {});
        ui.toast("设置保存失败，请重试", "bad");
      } finally { busy = false; refresh(); }
    }
    const body = el("div", {}, group("密码与访问", [
      status,
      el("p", { class: "access-sensitive-note", text: "查看、复制密码及导出备份，每 1 小时验证一次；永久免密码模式下也适用。" }),
      setRow({ icon: "keyhole", label: "永久关闭密码验证", desc: "仅影响本机 · 可随时恢复", control: permanent }),
      timing,
      setRow({ icon: "key", label: "管理密码", desc: "已设置 · 用于界面解锁，账号数据未加密", control: el("button", {
        class: "btn btn-ghost btn-xs", type: "button", text: "修改", onclick: () => OTP.sheets.openPasswordFlow() }) }),
      setRow({ icon: "lock", label: "锁定账号库", desc: "需要时立即恢复密码保护", control: lockButton }),
    ]), group("分类", [setRow({ icon: "tag", label: "管理分类", desc: `${store.categories().length} 个分类 · 随备份导出`,
      onTap: () => OTP.sheets.openCategoryManager(), control: el("span", { class: "set-value", html: icon("chevron-right", 14) }) })]));
    refresh();
    return { body, refresh, dispose() { remember.destroy(); idle.destroy(); } };
  };
})(globalThis);
