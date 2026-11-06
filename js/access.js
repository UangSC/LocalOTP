/* 页面端只持有本页凭证；免密到期与签发均由后台判定。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  const available = !!global.chrome?.runtime?.id && !!global.chrome?.storage?.session;
  let proof = "", expires = 0, issuedAt = 0;
  const revoked = new Set();
  async function request(action, extra = {}) {
    if (!available) return { ok: false };
    return await chrome.runtime.sendMessage({ type: "localotp:access", action, proof, ...extra }) || { ok: false };
  }
  function accept(result) {
    if (result.ok) { if (result.proof) proof = result.proof; expires = result.expires || 0; issuedAt = result.at || 0; }
    return result.ok;
  }
  if (available) chrome.storage.onChanged.addListener((changes, area) => {
    const change = area === "session" && changes["localotp:access:v1"];
    if (change?.oldValue && change.oldValue.epoch !== change.newValue?.epoch) {
      proof = ""; expires = 0; revoked.forEach(callback => callback());
    }
    if (change?.newValue) { expires = change.newValue.lease?.expires || 0; issuedAt = change.newValue.lease?.at || 0; }
  });
  OTP.access = {
    available,
    async unlock(password) { return available ? accept(await request("unlock", { password })) : OTP.store.verifyPassword(password); },
    async restore(ticket) { try { return available && accept(await request("restore", { ticket })); } catch (_) { return false; } },
    async remember() { return accept(await request("remember")); },
    async ticket() { const result = await request("ticket"); if (!result.ok) throw new Error("授权已失效，请重新解锁"); return result.ticket; },
    async float() { const result = await request("float"); if (!result.ok) throw new Error("无法打开小窗，请重新解锁后重试"); return result; },
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
