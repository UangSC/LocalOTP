/* ==========================================================================
   LocalOTP · totp
   RFC 4648 Base32、RFC 4226 (HOTP)、RFC 6238 (TOTP)，以及 otpauth:// 解析。
   全部走 Web Crypto；环境不支持时明确失败，绝不返回占位验证码。
   ========================================================================== */

(function (global) {
  "use strict";

  const OTP = global.OTP;

  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const ALGO = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

  /* ── Base32 ───────────────────────────────────────────────────────────── */

  function base32Decode(raw) {
    const s = String(raw || "")
      .replace(/[\s-]/g, "")
      .replace(/=+$/, "")
      .toUpperCase();
    if (!s) throw new Error("empty");

    let bits = 0;
    let val = 0;
    const out = [];
    for (const ch of s) {
      const idx = B32.indexOf(ch);
      if (idx < 0) throw new Error("invalid-char:" + ch);
      val = (val << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((val >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  /**
   * 严格校验：不做任何"猜测"式修补。
   * 非法字符、非法长度、填充位置、解码后长度不足都会给出具体原因。
   */
  function validateSecret(raw) {
    const shown = String(raw == null ? "" : raw);
    const compact = shown.replace(/\s/g, "");
    if (!compact) return { ok: false, error: "密钥不能为空" };
    if (compact.length > 2048) return { ok: false, error: "密钥过长（最多 2048 个字符）" };

    const upper = compact.toUpperCase();
    const noPad = upper.replace(/=+$/, "");
    const padCount = upper.length - noPad.length;

    if (padCount > 0 && upper.length % 8 !== 0) {
      return { ok: false, error: "Base32 填充位置不合法" };
    }
    if (/=/.test(noPad)) {
      return { ok: false, error: "填充符只能出现在结尾" };
    }
    const bad = noPad.split("").find((ch) => B32.indexOf(ch) < 0);
    if (bad) return { ok: false, error: `密钥包含非法字符「${bad}」` };
    if ([1, 3, 6].includes(noPad.length % 8)) return { ok: false, error: "密钥长度不合法（Base32 位数不足）" };
    if (padCount && padCount !== (8 - noPad.length % 8) % 8) return { ok: false, error: "Base32 填充数量不合法" };
    if (noPad.length < 10) return { ok: false, error: "密钥过短（至少 10 个字符）" };

    try {
      const bytes = base32Decode(upper);
      if (bytes.length < 8) return { ok: false, error: "密钥过短（解码后不足 8 字节）" };
      return { ok: true, normalized: noPad, bytes: bytes.length };
    } catch (err) {
      return { ok: false, error: "密钥不是合法的 Base32" };
    }
  }

  /* ── HMAC ─────────────────────────────────────────────────────────────── */

  const keyCache = new Map();

  async function hmacKey(algo, keyBytes, cache = true) {
    const id = algo + "|" + keyBytes.length + "|" + keyBytes.join(",");
    const cached = cache && keyCache.get(id);
    if (cached) return cached;

    const subtle = global.crypto && global.crypto.subtle;
    if (!subtle) throw new Error("浏览器不支持 Web Crypto，请使用最新版 Edge 或 Chrome");

    const key = await subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: ALGO[algo] },
      false,
      ["sign"]
    );
    if (cache) {
      if (keyCache.size >= 64) keyCache.delete(keyCache.keys().next().value);
      keyCache.set(id, key);
    }
    return key;
  }

  async function hmac(algo, keyBytes, msg, cache) {
    const subtle = global.crypto && global.crypto.subtle;
    if (!subtle) throw new Error("浏览器不支持 Web Crypto，请使用最新版 Edge 或 Chrome");
    const key = await hmacKey(algo, keyBytes, cache);
    const sig = await subtle.sign("HMAC", key, msg);
    return new Uint8Array(sig);
  }

  /* ── HOTP / TOTP ──────────────────────────────────────────────────────── */

  async function hotp(secret, opts, counter) {
    const o = opts || {};
    const algorithm = o.algorithm || "SHA1";
    const digits = o.digits == null ? 6 : Number(o.digits);
    if (!Object.hasOwn(ALGO, algorithm)) throw new Error("不支持的摘要算法");
    if (![6, 8].includes(digits)) throw new Error("验证码位数仅支持 6 或 8");
    if (!Number.isSafeInteger(counter) || counter < 0) throw new Error("计数器无效");
    const keyBytes = base32Decode(secret);
    const msg = new Uint8Array(8);
    const view = new DataView(msg.buffer);
    view.setUint32(0, Math.floor(counter / 4294967296), false);
    view.setUint32(4, counter % 4294967296, false);

    const hash = await hmac(algorithm, keyBytes, msg, o.cache !== false);
    const offset = hash[hash.length - 1] & 0x0f;
    const bin =
      ((hash[offset] & 0x7f) << 24) |
      (hash[offset + 1] << 16) |
      (hash[offset + 2] << 8) |
      hash[offset + 3];

    return String(bin % Math.pow(10, digits)).padStart(digits, "0");
  }

  /** 当前时间片的状态：进度、剩余秒、计数器 */
  function cycle(period, at) {
    const p = period == null ? 30 : Number(period);
    if (!Number.isInteger(p) || p < 1 || p > 86400) throw new Error("周期须为 1–86400 秒的整数");
    const now = (at == null ? Date.now() : at) / 1000;
    if (!Number.isFinite(now) || now < 0 || !Number.isSafeInteger(Math.floor(now / p))) throw new Error("系统时间无效");
    const elapsed = now % p;
    const counter = Math.floor(now / p);
    return {
      counter,
      elapsed,
      remaining: p - elapsed,
      progress: elapsed / p,
      period: p,
    };
  }

  /**
   * 为一个账号算码。返回剩余时间，让调用方决定要不要提示"即将刷新"。
   * @returns {Promise<{code:string, counter:number, remaining:number, simulated:boolean}>}
   */
  async function generate(account, at) {
    const opts = {
      algorithm: account.algorithm || "SHA1",
      digits: account.digits ?? 6,
      cache: account.cache !== false,
    };
    const c = cycle(account.period, at);
    try {
      const code = await hotp(account.secret, opts, c.counter);
      return { code, counter: c.counter, remaining: c.remaining, simulated: false };
    } catch (err) {
      throw new Error("验证码计算失败：" + (err && err.message ? err.message : "未知原因"));
    }
  }

  function hasSubtle() {
    return !!(global.crypto && global.crypto.subtle);
  }

  /* ── otpauth:// 解析 ──────────────────────────────────────────────────── */

  /**
   * 解析 otpauth://totp/Issuer:account?secret=...&issuer=...&digits=&period=&algorithm=
   * 二维码里扫出来的就是这一串。只接受 totp，hotp 需要计数器，明确拒绝。
   */
  function parseOtpauth(text) {
    const raw = String(text || "").trim();
    if (!/^otpauth:\/\//i.test(raw)) return null;

    let url;
    try {
      url = new URL(raw);
    } catch (err) {
      return null;
    }

    const type = (url.host || "").toLowerCase();
    if (type !== "totp") {
      return { error: type === "hotp" ? "暂不支持 hotp（基于计数器）" : "不支持的链接类型" };
    }

    const params = url.searchParams;
    for (const name of ["secret", "algorithm", "digits", "period", "issuer"]) {
      if (params.getAll(name).length > 1) return { error: "链接参数重复：" + name };
    }
    const secret = params.get("secret") || "";
    const check = validateSecret(secret);
    if (!check.ok) return { error: "链接里的密钥无效：" + check.error };

    let label;
    try { label = decodeURIComponent((url.pathname || "").replace(/^\/+/, "")); }
    catch (_) { return { error: "链接名称编码无效" }; }
    let issuer = params.get("issuer") || "";
    if (label.includes(":")) {
      const idx = label.indexOf(":");
      const head = label.slice(0, idx).trim();
      label = label.slice(idx + 1).trim();
      if (!issuer) issuer = head;
    }

    const algorithm = (params.get("algorithm") ?? "SHA1").toUpperCase().replace("-", "");
    const digits = Number(params.get("digits") ?? 6);
    const period = Number(params.get("period") ?? 30);
    if (!Object.hasOwn(ALGO, algorithm)) return { error: "不支持的摘要算法" };
    if (![6, 8].includes(digits)) return { error: "验证码位数仅支持 6 或 8" };
    if (!Number.isInteger(period) || period < 1 || period > 86400) return { error: "周期须为 1–86400 秒的整数" };

    return {
      secret: check.normalized,
      issuer: issuer.trim(),
      account: label.trim(),
      email: label.includes("@") ? label.trim() : "",
      algorithm,
      digits,
      period,
    };
  }

  /**
   * 构造标准 otpauth://totp/... 链接，便于导出为二维码导入到其他验证器。
   */
  function buildOtpauth(account) {
    if (!account || typeof account !== "object") throw new Error("账号数据无效");
    const check = validateSecret(account.secret);
    if (!check.ok) throw new Error(check.error);

    const issuer = String(account.issuer || "").trim();
    const labelAccount = String(account.email || "").trim();
    const safeIssuer = issuer.replace(/:/g, " ");
    let label;
    if (safeIssuer && labelAccount) {
      label = encodeURIComponent(safeIssuer) + ":" + encodeURIComponent(labelAccount);
    } else if (labelAccount) {
      label = encodeURIComponent(labelAccount);
    } else if (safeIssuer) {
      label = encodeURIComponent(safeIssuer);
    } else {
      label = "LocalOTP";
    }

    const params = new URLSearchParams();
    params.set("secret", check.normalized);
    if (issuer) params.set("issuer", issuer);
    const algorithm = Object.hasOwn(ALGO, account.algorithm) ? account.algorithm : "SHA1";
    const digits = Number(account.digits) === 8 ? 8 : 6;
    const period =
      Number.isInteger(Number(account.period)) && Number(account.period) >= 1 && Number(account.period) <= 86400
        ? Number(account.period)
        : 30;
    if (algorithm !== "SHA1") params.set("algorithm", algorithm);
    if (digits !== 6) params.set("digits", String(digits));
    if (period !== 30) params.set("period", String(period));

    return `otpauth://totp/${label}?${params.toString()}`;
  }

  OTP.totp = {
    base32Decode,
    validateSecret,
    hotp,
    generate,
    cycle,
    parseOtpauth,
    buildOtpauth,
    hasSubtle,
    clearKeyCache: () => keyCache.clear(),
    ALGORITHMS: ["SHA1", "SHA256", "SHA512"],
    ALGO_LABEL: { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" },
  };
})(window);
