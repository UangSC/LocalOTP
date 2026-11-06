/* 只读恢复：所有存储操作均为 get，不实例化原项目的 store / sync 执行器。 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let localData = null, remoteData = null, busy = false;
  const empty = { accounts: [], categories: [], tombstones: {}, categoryTombstones: {} };
  async function inspect() {
    if (busy) return;
    busy = true; $("refresh").disabled = true;
    try {
      $("identity").textContent = "当前扩展 ID：" + chrome.runtime.id;
      if (globalThis.expectedExtensionId && chrome.runtime.id !== globalThis.expectedExtensionId) throw new Error("加载 ID 与预期旧 ID 不一致，已停止读取。请使用原来的完整加载路径。");
      const [local, remote] = await Promise.all([chrome.storage.local.get("localotp:data:v2"), chrome.storage.sync.get(null)]);
      localData = local["localotp:data:v2"];
      const decoded = OTP.syncModel.decode(remote, value => value && typeof value === "object" && typeof value.secret === "string" ? value : null);
      remoteData = OTP.syncModel.merge(empty, decoded);
      const localCount = Array.isArray(localData?.accounts) ? localData.accounts.length : 0;
      const remoteCount = remoteData.accounts.length;
      $("local-count").textContent = `旧本机账号：${localCount} 条`;
      $("sync-count").textContent = `旧同步缓存账号：${remoteCount} 条`;
      $("export-local").disabled = !localCount; $("export-sync").disabled = !remoteCount;
      $("status").textContent = localCount || remoteCount ? "已找到可导出的旧记录。" : "当前尚未找到旧账号。请确认浏览器账号同步已开启，再重新检查；卸载前的数据是否仍在云端需要浏览器实际送达才能确认。";
    } catch (error) {
      $("status").textContent = "检查未完成：" + error.message;
      $("export-local").disabled = true; $("export-sync").disabled = true;
    } finally { busy = false; $("refresh").disabled = false; }
  }
  function download(data, source) {
    if (!data?.accounts?.length) return;
    const payload = { format: "localotp.backup", version: 2, exportedAt: Date.now(), accounts: data.accounts, categories: data.categories || [] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `localotp-recovered-${source}-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("refresh").addEventListener("click", inspect);
  $("export-local").addEventListener("click", () => download(localData, "local"));
  $("export-sync").addEventListener("click", () => download(remoteData, "sync"));
  chrome.storage.onChanged.addListener((_changes, area) => { if (area === "sync") inspect(); });
  inspect();
})();
