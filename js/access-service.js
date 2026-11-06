/* 后台门禁会话：只存于 storage.session，不保存密码，不进入 local/sync。
   所有操作排队；签发基于真实密码校验，短期授权绑定密码版本和浏览器会话。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  // 工具栏 POPUP 的 MessageSender 在 Edge 中可能没有 documentId；不能把它误判为未登录。
  // 每个页面的随机 clientId 只标识调用者，授权仍必须通过密码和后台签发的 proof。
  OTP.accessCaller = function (message, sender, extensionId) {
    try {
      const url = new URL(sender.url);
      if (sender.id !== extensionId || url.protocol !== "chrome-extension:" || url.hostname !== extensionId || !["/popup.html", "/index.html"].includes(url.pathname)) return null;
      if (typeof sender.documentId === "string" && sender.documentId) return "document:" + sender.documentId;
      if (typeof message.clientId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(message.clientId)) return "page:" + message.clientId;
    } catch (_) {}
    return null;
  };
  OTP.createAccessService = function ({ readLocal, readSession, writeSession, verify, now = Date.now,
    random = () => crypto.randomUUID() }) {
    let queue = Promise.resolve();
    const versionOf = security => security?.hash ? `${security.salt}:${security.createdAt}` : "";
    const minutesOf = settings => [1, 5, 15].includes(settings?.rememberMinutes) ? settings.rememberMinutes : 0;
    async function operate(message, caller) {
      const local = await readLocal();
      const version = versionOf(local.security), minutes = minutesOf(local.settings), time = now();
      let state = await readSession();
      const disabled = local.settings?.passwordRequired === false;
      if (!state || state.version !== version || !!state.disabled !== disabled) state = {
        version, disabled, verifiedAt: state?.version === version ? state.verifiedAt || 0 : 0,
        epoch: random(), proofs: {}, tickets: {}, lease: null,
      };
      state.proofs ||= {}; state.tickets ||= {};
      // 清理旧页面凭证；重复打开不延长免密到期时间。
      for (const [key, proof] of Object.entries(state.proofs)) if (time < proof.at || time - proof.at > 86400000) delete state.proofs[key];
      for (const [key, ticket] of Object.entries(state.tickets)) if (time >= ticket.expires || time < ticket.at) delete state.tickets[key];
      if (!minutes || !state.lease || state.lease.minutes !== minutes || time < state.lease.at || time >= state.lease.expires) state.lease = null;
      const issue = (at = time) => {
        const keys = Object.keys(state.proofs);
        if (keys.length >= 128) delete state.proofs[keys[0]];
        const proof = random(); state.proofs[caller] = { token: proof, at };
        return { ok: true, proof, epoch: state.epoch, expires: state.lease?.expires || 0, at: state.lease?.at || 0 };
      };
      const authorized = () => version && typeof message.proof === "string" && message.proof.length > 0 && Object.hasOwn(state.proofs, caller) && state.proofs[caller].token === message.proof;
      let result = { ok: false };
      switch (message.action) {
        case "check": result = authorized() ? { ok:true, epoch:state.epoch } : { ok:false,code:"AUTH_REQUIRED",error:"当前页面授权已失效，请重新解锁" }; break;
        case "unlock": {
          if (!version || typeof message.password !== "string") break;
          if (!await verify(message.password, local.security)) break;
          // PBKDF2 期间可能改密；旧密码通过也不得拿到新版本授权。
          const current = await readLocal();
          if (versionOf(current.security) !== version) break;
          const liveMinutes = minutesOf(current.settings);
          state.verifiedAt = time;
          state.lease = liveMinutes ? { at: time, expires: time + liveMinutes * 60000, minutes: liveMinutes } : null;
          result = issue(); break;
        }
        case "restore": {
          if (!version) break;
          if (typeof message.ticket === "string" && Object.hasOwn(state.tickets, message.ticket)) {
            const ticket = state.tickets[message.ticket]; delete state.tickets[message.ticket]; result = issue(ticket.verifiedAt);
          } else if (!message.ticket && (disabled || state.lease)) result = issue(state.lease?.at || time);
          break;
        }
        case "remember": {
          if (!authorized()) { result = { ok: false, code: "AUTH_REQUIRED", error: "当前页面授权已失效，请锁定后重新解锁" }; break; }
          const at = state.proofs[caller].at;
          state.lease = minutes && time < at + minutes * 60000 ? { at, expires: at + minutes * 60000, minutes } : null;
          result = { ok: true, expires: state.lease?.expires || 0, at: state.lease?.at || 0 }; break;
        }
        case "sensitive-check":
        case "sensitive-verify": {
          if (!authorized()) { result = { ok: false, code: "AUTH_REQUIRED" }; break; }
          if (message.action === "sensitive-verify") {
            if (time < (state.retryAfter || 0)) { result = { ok: false, error: "尝试次数过多，请稍后再试" }; break; }
            if (typeof message.password !== "string" || !await verify(message.password, local.security)) {
              state.failures = (state.failures || 0) + 1;
              if (state.failures >= 5) { state.retryAfter = time + 20000; state.failures = 0; }
              result = { ok: false, code: "WRONG_PASSWORD" }; break;
            }
            if (versionOf((await readLocal()).security) !== version) break;
            state.verifiedAt = now(); state.failures = 0; state.retryAfter = 0;
          }
          const checkedAt = now();
          const fresh = state.verifiedAt > 0 && checkedAt >= state.verifiedAt && checkedAt < state.verifiedAt + 3600000;
          result = { ok: fresh, code: fresh ? undefined : "REVERIFY_REQUIRED", verifiedUntil: fresh ? state.verifiedAt + 3600000 : 0 };
          break;
        }
        case "ticket": {
          if (!authorized()) { result = { ok: false, code: "AUTH_REQUIRED", error: "当前页面授权已失效，请锁定后重新解锁" }; break; }
          const ticket = random();
          state.tickets[ticket] = { at: time, expires: time + 10000, verifiedAt: state.proofs[caller].at };
          result = { ok: true, ticket }; break;
        }
        case "revoke":
          state = { version, disabled, epoch: random(), proofs: {}, tickets: {}, lease: null }; result = { ok: true }; break;
        case "refresh": result = { ok: true }; break;
      }
      await writeSession(state);
      return result;
    }
    return { request(message, caller) {
      const result = queue.catch(() => {}).then(() => operate(message, caller));
      queue = result; return result;
    } };
  };
})(globalThis);
