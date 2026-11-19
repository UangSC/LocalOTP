/* 同步、备份和其他设置。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { field, group, setRow, changed } = OTP.sheetUI;
  function settingsPane() {
    const settings = store.settings();
    const body = el("div", { class: "settings-pane" });

    const appearance=OTP.sheetParts.appearanceSettings();
    body.append(appearance.body);

    const access=OTP.sheetParts.accessSettings();
    body.append(access.body);

    /* ---- 数据 ---- */

    const syncAvailable = store.sync.available();
    const usage = { used: 0, quota: 102400 };
    const meterFill = el("i", { style: { width: "2%" } });
    const meterText = el("span", { class: "meter-txt", text: "0 B / 100 KB" });
    const meterRow = el("div", { class: "meter-row" }, el("div", { class: "meter" }, meterFill), meterText);
    meterRow.hidden = !settings.syncEnabled;

    const syncDesc = el("span", {
      text: syncAvailable
        ? settings.syncEnabled
          ? settings.lastSyncAt
            ? `已开启 · 上次本机缓存合并 ${OTP.fmt.clockText(settings.lastSyncAt)}`
            : "已开启 · 等待首次缓存合并"
          : "已关闭 · 数据只在本机"
        : "请在扩展中使用（本地预览不支持）",
      hidden: false,
    });

    const syncToggle = el("button", {
      class: "toggle",
      type: "button",
      role: "switch",
      "aria-checked": String(!!settings.syncEnabled),
      "aria-label": "浏览器同步",
      disabled: !syncAvailable,
      onclick: async (event) => {
        if (!syncAvailable) {
          ui.toast("这个环境里读不到 chrome.storage.sync", "warn");
          return;
        }
        const on = syncToggle.getAttribute("aria-checked") === "true";
        syncToggle.disabled = true;
        try {
          if (on) {
            await store.sync.disable();
            syncToggle.setAttribute("aria-checked", "false");
            syncDesc.textContent = "已关闭 · 数据只在本机";
            meterRow.hidden = true;
            ui.toast("已关闭同步");
          } else {
            syncToggle.setAttribute("aria-checked", "true");
            syncDesc.textContent = "正在同步…";
            const result = await store.sync.enable();
            syncDesc.textContent = `已开启 · 本机缓存合入 ${result.pulled} 条 · 未确认云端传输`;
            meterRow.hidden = false;
            await updateUsage();
            changed("sync");
            showSyncResult(result);
          }
        } catch (err) {
          syncToggle.setAttribute("aria-checked", String(!!store.settings().syncEnabled));
          syncDesc.textContent = "同步失败 · " + (err.message || "未知原因");
          ui.toast("同步失败：" + (err.message || "未知原因"), "bad");
        } finally {
          syncToggle.disabled = !syncAvailable;
        }
      },
    });

    async function updateUsage() {
      if (!store.sync.available()) {
        meterText.textContent = "不可用";
        return;
      }
      const info = await store.sync.usage();
      usage.used = info.used;
      usage.quota = info.quota;
      const pct = OTP.clamp((info.used / info.quota) * 100, 1.5, 100);
      meterFill.style.width = pct.toFixed(1) + "%";
      if (info.error) { meterText.textContent = "容量读取失败：" + info.error; return; }
      meterText.textContent = `${OTP.fmt.bytes(info.used)} / ${Math.round(info.quota / 1024)} KB`;
    }
    updateUsage();

    const syncRow = setRow({
      icon: "sync",
      label: "浏览器同步",
      descNode: [syncDesc, meterRow],
      control: syncToggle,
    });

    const syncNowButton = el("button", {
      class: "btn btn-ghost btn-xs", type: "button", text: "立即同步",
      onclick: async () => {
        syncNowButton.disabled = true;
        const result = await store.sync.now();
        showSyncResult(result);
        updateSyncState();
        updateUsage();
      },
    });
    function showSyncResult(result) {
      const feedback = OTP.syncFeedback(result);
      ui.toast(feedback.text, feedback.kind, { duration: 6500 });
    }
    const diagnosticBox = el("div", { class: "sync-help", id: "sync-diagnostics", hidden: true, role: "status" });
    const inspectButton = el("button", { class: "btn btn-ghost btn-xs", type: "button", id: "sync-inspect", text: "只读检查",
      disabled: !syncAvailable, onclick: async () => {
        inspectButton.disabled = true;
        try {
          const report = await store.sync.inspect();
          diagnosticBox.replaceChildren(); diagnosticBox.hidden = false;
          if (!report.ok) { diagnosticBox.append(el("p", { text: report.error })); return; }
          diagnosticBox.append(el("code", { text: "当前扩展 ID：" + report.extensionId }),
            el("p", { text: `版本 ${report.extensionVersion || "未知"} · 插件同步${report.enabled ? "已开启" : "已关闭"}` }),
            el("p", { text: `本机账号 ${report.localAccounts} 条 · 当前同步缓存账号 ${report.cachedAccounts} 条 · 分类 ${report.cachedCategories} 条` }),
            el("p", { text: report.cachedAccounts ? "缓存可来自本机写入或浏览器传入；这些条数不能证明已上传，也不能证明其他设备已收到。" : "当前浏览器的同步缓存为空。两端 ID 一致时，需要检查浏览器的传输状态，不能据此判定旧版 ID 有问题。" }),
            el("p", { text: "在两台浏览器分别打开 edge://sync-internals（Chrome 使用 chrome://sync-internals），检查 Transport State、Disable Reasons 和 Type Info 中的 Extension Settings。" }),
            el("p", { text: "Extensions 与 Extension Settings 是不同数据类型；扩展安装列表同步正常，不代表账号数据正在传输。" }),
            el("p", { text: "此检查不会修改本机或同步记录，也无法读取其他扩展 ID 的空间。" }));
        } finally { inspectButton.disabled = !syncAvailable; }
      } });
    function updateSyncState() {
      const info = store.sync.info();
      syncToggle.setAttribute("aria-checked", String(info.enabled));
      syncNowButton.disabled = !info.available || !info.enabled || info.busy;
      syncNowButton.textContent = info.busy ? "同步中…" : info.error ? "重试同步" : "立即同步";
      meterRow.hidden = !info.enabled;
      syncDesc.textContent = !info.available ? "请在扩展中使用（本地预览不支持）"
        : !info.enabled ? "已关闭 · 数据只在本机"
        : info.busy ? "正在与浏览器同步存储合并…"
        : info.error ? "同步失败 · " + info.error
        : info.lastResult?.remoteAccounts === 0 && info.lastResult?.localAccounts === 0 ? "本机同步缓存为空 · 请检查浏览器传输状态"
        : info.lastSyncAt ? "本机缓存已合并 " + OTP.fmt.clockText(info.lastSyncAt) + " · 未确认云端传输" : "等待首次缓存合并";
    }
    updateSyncState();
    const unsubscribe = store.subscribe((reason) => {
      if (reason.startsWith("sync") || reason.includes("settings")) updateSyncState();
      if (reason.includes("settings")) { appearance.refresh(); access.refresh(); }
    });
    const stats = store.stats();

    body.append(
      group("同步与备份", [
        syncRow,
        setRow({ icon: "refresh", label: "同步状态", desc: "合并本机同步缓存；云端传输由浏览器负责", control: syncNowButton }),
        setRow({ icon: "info", label: "同步诊断", desc: "检查当前扩展 ID、本机和同步缓存条数", control: inspectButton }),
        diagnosticBox,
        el("p", { class: "field-hint", text: "同一种浏览器登录同一账号，并开启扩展同步；两台设备需使用同一扩展 ID。浏览器决定云端传输时间，完成本地合并不等于另一台设备已收到。" }),
        el("p", { class: "field-hint", text: "开启后，账号密码与 TOTP 密钥将写入浏览器同步存储，未做端到端加密；管理密码不上云。" }),
        el("details", { class: "sync-help" },
          el("summary", { text: "另一台浏览器如何拉取？" }),
          el("ol", {},
            el("li", { text: "源浏览器登录账号，并同时开启浏览器同步和本扩展的浏览器同步，然后点击立即同步。" }),
            el("li", { text: "目标设备使用同一种浏览器、同一浏览器账号、同一扩展 ID。首次打开先设置该设备的管理密码。" }),
            el("li", { text: "目标扩展开启浏览器同步，再点击立即同步。浏览器送达的云端记录会自动合并到本地，不需要手动导入。" })),
          el("p", { text: "Edge 与 Chrome 的云端不互通。浏览器未登录或关闭自身同步时，同步存储可能只保存在本机；插件无法强制云端立即送达。" }),
          el("p", { text: "固定 key 版本不受加载路径影响。只有旧的无 key 版本可能因路径不同产生不同 ID；ID 一致仍需检查 Extension Settings 的传输状态。" }),
          el("code", { text: "本机扩展 ID：" + (global.chrome?.runtime?.id || "本地预览，无扩展 ID") })),
        setRow({
          icon: "download",
          label: "导出备份",
          desc: `UTF-8 JSON · ${stats.count} 个账号 · 含密码与密钥`,
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            html: icon("download", 12, "i-sm") + "<span>导出</span>",
            onclick: () => OTP.app.exportBackup(),
          }),
        }),
        setRow({
          icon: "upload",
          label: "导入备份",
          desc: "按邮箱合并，不覆盖已有记录",
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            html: icon("upload", 12, "i-sm") + "<span>导入</span>",
            onclick: () => OTP.app.importBackup(),
          }),
        }),
      ])
    );

    /* ---- 地址栏入口 ---- */
    const entryUrl = new URL("api.html", location.href).href;
    body.append(group("临时验证码与地址栏 API", [
      el("div", { class: "entry-setting" },
        el("p", { text: "地址栏输入 otp，按 Tab 或空格进入 LocalOTP，然后粘贴密钥并回车。也可打开独立页面，直接粘贴密钥或 otpauth 链接。" }),
        el("div", { class: "entry-code", text: entryUrl + "#otp=YOUR_BASE32_SECRET" }),
        el("p", { text: "支持 algorithm、digits、period 参数。临时密钥不进入账号库；地址栏输入可能留在浏览器历史，敏感密钥建议在页面输入框中填写。" }),
        el("div", { class: "entry-actions" },
          el("a", { class: "btn btn-ghost btn-xs", href: entryUrl, target: "_blank", rel: "noopener", text: "打开验证码页面" }),
          el("button", { class: "btn btn-ghost btn-xs", type: "button", text: "复制入口地址", onclick: async () => {
            const ok = await OTP.copyText(entryUrl + "#otp=");
            ui.toast(ok ? "入口地址已复制" : "复制失败，请手动选择地址", ok ? "ok" : "bad");
          } })
        )
      )
    ]));

    /* ---- 危险区 ---- */

    body.append(
      group("本机数据", [
        setRow({
          icon: "history",
          label: "恢复演示数据",
          desc: "覆盖当前账号列表，回到初始的 10 条示例",
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            text: "恢复",
            onclick: async () => {
              const ok = await ui.confirm({
                title: "恢复演示数据？",
                message: "当前全部账号会被替换成 10 条示例记录，此操作不可撤销。",
                confirmText: "覆盖",
                danger: true,
              });
              if (!ok) return;
              store.resetDemo();
              changed("reset");
              ui.toast("演示数据已恢复", "warn");
            },
          }),
        }),
        setRow({
          icon: "trash",
          label: "清空本机数据",
          desc: "删除全部账号与分类，管理密码也会一并清除",
          control: el("button", {
            class: "btn btn-ghost btn-xs",
            type: "button",
            html: icon("trash", 12, "i-sm") + "<span>清空</span>",
            style: { color: "var(--danger)" },
            onclick: async () => {
              const ok = await ui.confirm({
                title: "清空全部本机数据？",
                message:
                  "账号、分类与管理密码都会被删除，且无法恢复。若需要保留，请先导出备份。",
                confirmText: "全部清空",
                danger: true,
                icon: "trash",
              });
              if (!ok) return;
              await store.wipe();
              ui.closeSheet(true);
              OTP.app.relockAfterWipe();
            },
          }),
        }),
      ])
    );

    body.append(
      el(
        "div",
        { class: "note" },
        el("span", { html: icon("shield", 13) }),
        el("div", {}, "账号密码与 TOTP 密钥以未加密形式保存在扩展存储中，管理密码只用于阻止他人随手查看，不参与任何加密。")
      )
    );

    body.append(
      el("p", {
        class: "sheet-footnote",
        text: `LocalOTP ${OTP.version} · 本地存储 / 可选浏览器同步`,
      })
    );

    return { body, footer: null, dispose() { unsubscribe(); appearance.dispose(); access.dispose(); } };
  }

  /* 管理抽屉（导入 / 设置） */


  Object.assign(OTP.sheetParts, { settingsPane });
})(globalThis);
