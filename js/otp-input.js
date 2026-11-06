/* 临时验证与地址栏入口的输入契约。纯解析，不读取账号库，不保存密钥。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  const MAX_INPUT = 8192;
  function parse(raw, options = {}) {
    const text = String(raw ?? "").trim();
    if (!text) return { empty: true };
    if (text.length > MAX_INPUT) return { error: "输入过长，请只粘贴一个 OTP 密钥或 otpauth 链接" };
    if (/^otpauth:/i.test(text)) {
      const result = OTP.totp.parseOtpauth(text);
      if (!result) return { error: "otpauth 链接格式无效" };
      if (result.error) return result;
      if (Object.keys(options).length) return { error: "otpauth 链接已包含参数，请勿再追加算法、位数或周期" };
      return { account: { ...result, cache: false }, label: result.issuer || result.account || "临时验证码" };
    }
    const check = OTP.totp.validateSecret(text);
    if (!check.ok) return { error: check.error };
    const algorithm = String(options.algorithm ?? "SHA1").toUpperCase().replace("-", "");
    const digits = Number(options.digits ?? 6);
    const period = Number(options.period ?? 30);
    if (!OTP.totp.ALGORITHMS.includes(algorithm)) return { error: "摘要算法仅支持 SHA-1、SHA-256 或 SHA-512" };
    if (![6, 8].includes(digits)) return { error: "验证码位数仅支持 6 或 8" };
    if (!Number.isInteger(period) || period < 1 || period > 86400) return { error: "周期须为 1–86400 秒的整数" };
    return { account: { secret: check.normalized, algorithm, digits, period, cache: false }, label: "临时验证码" };
  }

  function readLocation(href) {
    const url = new URL(href);
    const query = url.search.slice(1);
    const fragment = url.hash.slice(1);
    if (query && fragment) return { error: "请将参数放在 # 或 ? 后的同一处，避免密钥歧义" };
    const source = fragment || query;
    if (!source) return { raw: "", options: {} };
    if (source.length > MAX_INPUT * 3) return { error: "链接参数过长" };
    if (/%(?![0-9a-f]{2})/i.test(source)) return { error: "链接参数编码无效" };
    // 简写 #BASE32 与 #otpauth://…；推荐使用 #otp=encodeURIComponent(value)。
    if (fragment && (!source.includes("=") || /^otpauth(?::|%3a)/i.test(source) || OTP.totp.validateSecret(source).ok)) {
      try { return { raw: decodeURIComponent(source), options: {} }; }
      catch (_) { return { error: "链接参数编码无效" }; }
    }
    const params = new URLSearchParams(source);
    const allowed = ["otp", "secret", "uri", "algorithm", "digits", "period"];
    for (const [key] of params) {
      if (!allowed.includes(key)) return { error: "不支持的链接参数，请使用 otp、secret、uri、algorithm、digits、period" };
      if (params.getAll(key).length > 1) return { error: "链接参数重复：" + key };
    }
    const names = ["otp", "secret", "uri"].filter(key => params.has(key));
    if (names.length !== 1) return { error: "链接须包含且仅包含一个 otp、secret 或 uri 参数" };
    const raw = params.get(names[0]);
    if (!raw?.trim()) return { error: "链接中的 OTP 密钥为空" };
    const options = {};
    for (const key of ["algorithm", "digits", "period"]) if (params.has(key)) options[key] = params.get(key);
    return { raw, options };
  }

  function entryUrl(base, raw = "") {
    const text = String(raw).trim();
    return base + (text ? "#otp=" + encodeURIComponent(text) : "");
  }
  OTP.otpInput = { parse, readLocation, entryUrl, MAX_INPUT };
})(globalThis);
