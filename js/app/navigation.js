/* navigation 应用控制器。 */
(function (global) {
  "use strict";
  global.OTP.createNavigation = function ({ runtime, renderAll } = {}) {
    const OTP = global.OTP;
    const { el } = OTP;
    const store = OTP.store, ui = OTP.ui;
    async function openFullPage() {
      const chromeApi = global.chrome;
      if (OTP.access.available) {
        if (runtime.lockNode || runtime.transitioning) { ui.toast("请先解锁当前页面", "warn"); return; }
        try { return await OTP.access.openPage(); }
        catch (error) { ui.toast("打开管理页失败：" + error.message, "bad"); return; }
      }
      try {
        // 扩展里优先走 options 页：会复用已打开的标签，不会每次新开一个
        if (chromeApi && chromeApi.runtime && chromeApi.runtime.openOptionsPage) {
          chromeApi.runtime.openOptionsPage();
          return;
        }
        if (chromeApi && chromeApi.tabs && chromeApi.runtime && chromeApi.runtime.getURL) {
          chromeApi.tabs.create({ url: chromeApi.runtime.getURL("index.html") });
          return;
        }
      } catch (err) {
        /* 落到下面的兜底 */
      }
      global.open("index.html", "_blank");
    }

    /* 备份 */

    function exportBackup() {
      const payload = store.exportPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const name =
        `localotp-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}.json`;

      const a = el("a", { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);

      store.patchSettings({ lastBackupAt: Date.now() });
      ui.toast(`已导出 ${payload.accounts.length} 个账号`);
    }

    function importBackup() {
      const input = el("input", { type: "file", accept: ".json,application/json", hidden: true });
      document.body.append(input);
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) {
          input.remove();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const payload = JSON.parse(String(reader.result || ""));
            const result = store.importPayload(payload);
            renderAll({ stagger: true });
            if (result.added) ui.toast(`已合并 ${result.added} 条记录${result.skipped ? `，跳过 ${result.skipped} 条` : ""}`);
            else ui.toast("没有新的可合并记录", "warn");
          } catch (err) {
            ui.toast("备份文件无法解析", "bad");
          }
          input.remove();
        };
        reader.readAsText(file, "utf-8");
      });
      input.click();
    }

    /* 聚焦锁定 */


    return { openFullPage, exportBackup, importBackup };
  };
})(globalThis);
