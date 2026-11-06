/* 后台门禁会话：只存于 storage.session，不保存密码，不进入 local/sync。
   所有操作排队；签发基于真实密码校验，短期授权绑定密码版本和浏览器会话。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  OTP.createAccessService = function ({ readLocal, readSession, writeSession, verify, now = Date.now,
    random = () => crypto.randomUUID() }) {
    let queue = Promise.resolve();
    const versionOf = security => security?.hash ? `${security.salt}:${security.createdAt}` : "";
    const minutesOf = settings => [1, 5, 15].includes(settings?.rememberMinutes) ? settings.rememberMinutes : 0;
    async function operate(message, caller) {
      const local = await readLocal();
      const version = versionOf(local.security), minutes = minutesOf(local.settings), time = now();
      let state = await readSession();
      if (!state || state.version !== version) state = { version, epoch: random(), proofs: {}, tickets: {}, lease: null };
      state.proofs ||= {}; state.tickets ||= {};
      // 清理旧页面凭证；重复打开不延长免密到期时间。
      for (const [key, proof] of Object.entries(state.proofs)) if (time < proof.at || time - proof.at > 86400000) delete state.proofs[key];
      for (const [key, ticket] of Object.entries(state.tickets)) if (time >= ticket.expires || time < ticket.at) delete state.tickets[key];
      if (!minutes || !state.lease || state.lease.minutes !== minutes || time < state.lease.at || time >= state.lease.expires) state.lease = null;
      const issue = (at = time) => {
        const keys = Object.keys(state.proofs);
        if (keys.length >= 128) delete state.proofs[keys[0]];
        const proof = random(); state.proofs[caller] = { token: proof, at };
        return { ok: true, proof, expires: state.lease?.expires || 0, at: state.lease?.at || 0 };
      };
      const authorized = () => version && typeof message.proof === "string" && message.proof.length > 0 && Object.hasOwn(state.proofs, caller) && state.proofs[caller].token === message.proof;
      let result = { ok: false };
      switch (message.action) {
        case "unlock": {
          if (!version || typeof message.password !== "string") break;
          if (!await verify(message.password, local.security)) break;
          // PBKDF2 期间可能改密；旧密码通过也不得拿到新版本授权。
          const current = await readLocal();
          if (versionOf(current.security) !== version) break;
          const liveMinutes = minutesOf(current.settings);
          state.lease = liveMinutes ? { at: time, expires: time + liveMinutes * 60000, minutes: liveMinutes } : null;
          result = issue(); break;
        }
        case "restore": {
          if (!version) break;
          if (typeof message.ticket === "string" && Object.hasOwn(state.tickets, message.ticket)) {
            const ticket = state.tickets[message.ticket]; delete state.tickets[message.ticket]; result = issue(ticket.verifiedAt);
          } else if (!message.ticket && state.lease) result = issue(state.lease.at);
          break;
        }
        case "remember": {
          if (!authorized()) break;
          const at = state.proofs[caller].at;
          state.lease = minutes && time < at + minutes * 60000 ? { at, expires: at + minutes * 60000, minutes } : null;
          result = { ok: true, expires: state.lease?.expires || 0, at: state.lease?.at || 0 }; break;
        }
        case "ticket": {
          if (!authorized()) break;
          const ticket = random();
          state.tickets[ticket] = { at: time, expires: time + 10000, verifiedAt: state.proofs[caller].at };
          result = { ok: true, ticket }; break;
        }
        case "revoke":
          state = { version, epoch: random(), proofs: {}, tickets: {}, lease: null }; result = { ok: true }; break;
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
