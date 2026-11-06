/* security 数据规则。 */
(function (global) {
  "use strict";
  global.OTP.createSecurityStore = function ({ state, SEC_KEY, writeKey, removeKey, emit } = {}) {
    const OTP = global.OTP;
    const PBKDF2_ITERATIONS = 210000;
    const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
    const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

    async function derive(password, salt, iterations) {
      const subtle = global.crypto && global.crypto.subtle;
      const enc = new TextEncoder();
      if (subtle) {
        const key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await subtle.deriveBits(
          { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
          key,
          256
        );
        return new Uint8Array(bits);
      }
      // 无 Web Crypto 时退化为单轮 SHA-256(salt + password)，并明确标注
      throw new Error("当前环境不支持安全密码校验，请通过扩展或 localhost 打开");
    }

    async function setPassword(password) {
      const salt = new Uint8Array(16);
      if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(salt);
      else for (let i = 0; i < salt.length; i++) salt[i] = Math.floor(Math.random() * 256);

      const hasSubtle = !!(global.crypto && global.crypto.subtle);
      const iterations = hasSubtle ? PBKDF2_ITERATIONS : 0;
      const hash = await derive(password, salt, iterations);

      const record = {
        v: 1,
        algo: hasSubtle ? "PBKDF2-SHA256" : "none",
        iterations,
        salt: b64(salt),
        hash: b64(hash),
        createdAt: Date.now(),
      };
      state.security = record;
      await writeKey(SEC_KEY, record);
      emit("security");
      return record;
    }

    async function verifyPassword(password, record = state.security) {
      if (!record || !record.hash || record.algo === "none") return false;
      const salt = unb64(record.salt);
      const hash = await derive(password, salt, record.iterations || 0);
      const expected = unb64(record.hash);
      if (hash.length !== expected.length) return false;
      let diff = 0;
      for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
      return diff === 0;
    }

    function hasPassword() {
      return !!(state.security && state.security.hash);
    }

    function securityInfo() {
      if (!state.security) return null;
      return {
        algorithm: state.security.algo,
        iterations: state.security.iterations,
        createdAt: state.security.createdAt,
      };
    }

    async function clearPassword() {
      state.security = null;
      await removeKey(SEC_KEY);
      emit("security");
    }

    /* ── 检索 ─────────────────────────────────────────────────────────────── */


    return { setPassword, verifyPassword, hasPassword, securityInfo, clearPassword };
  };
})(globalThis);
