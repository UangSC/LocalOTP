/* 页面端只持有本页凭证；免密到期与签发均由后台判定。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  const available = !!global.chrome?.runtime?.id && !!global.chrome?.storage?.session;
  const clientId = available ? global.crypto.randomUUID() : "";
  let proof = "", expires = 0, issuedAt = 0, acceptedEpoch = "";
  const revoked = new Set();
  async function request(action, extra = {}) {
    if (!available) return { ok: false };
    const result = await chrome.runtime.sendMessage({ type: "localotp:access", action, clientId, proof, ...extra });
    if (!result) throw new Error("扩展后台未响应，请重新加载扩展");
    if (result.error) throw new Error(result.error);
    return result;
  }
  function accept(result) {
    if (result.ok) { if (result.proof) proof = result.proof; if (result.epoch) acceptedEpoch = result.epoch; expires = result.expires || 0; issuedAt = result.at || 0; }
    return result.ok;
  }
  if (available) chrome.storage.onChanged.addListener((changes, area) => {
    const change = area === "session" && changes["localotp:access:v1"];
    if (change?.oldValue && change.oldValue.epoch !== change.newValue?.epoch && change.newValue?.epoch !== acceptedEpoch) {
      proof = ""; expires = 0; revoked.forEach(callback => callback());
    }
    if (change?.newValue) { expires = change.newValue.lease?.expires || 0; issuedAt = change.newValue.lease?.at || 0; }
  });
  OTP.access = {
    available,
    async unlock(password) { return available ? accept(await request("unlock", { password })) : OTP.store.verifyPassword(password); },
    async restore(ticket) { try { return available && accept(await request("restore", { ticket })); } catch (_) { return false; } },
    async remember() { return accept(await request("remember")); },
    async ticket() { const result = await request("ticket"); if (!result.ok) throw new Error("当前页面授权已失效，请锁定后重新解锁"); return result.ticket; },
    async float() { const result = await request("float"); if (!result.ok) throw new Error("当前页面授权已失效，请锁定后重新解锁"); return result; },
    async openPage() { const result = await request("page"); if (!result.ok) throw new Error("当前页面授权已失效，请锁定后重新解锁"); return result; },
    async revoke() {
      proof = ""; expires = 0;
      if (!available) return;
      try { if (!(await request("revoke")).ok) throw new Error("会话清理失败"); }
      catch (error) {
        // 会话写入失败时，至少关闭持久偏好，使后台拒绝后续免密恢复。
        OTP.store.patchSettings({ rememberMinutes: 0 });
        await OTP.store.persist();
        throw error;
      }
    },
    onRevoked(callback) { revoked.add(callback); },
    get expires() { return expires; },
    get graceActive() { return !!OTP.store.settings().rememberMinutes && Date.now() >= issuedAt && expires > Date.now(); },
  };
})(globalThis);
