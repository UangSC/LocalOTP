/* 离线 QR 解码与 OTP 链接解析。不访问链接指向的网站。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  function parse(raw) {
    const text = String(raw || "").trim();
    if (/^https?:\/\//i.test(text)) {
      let location;
      try { location = OTP.otpInput.readLocation(text); } catch (_) { return { error: "链接格式无效" }; }
      if (location.error || !location.raw) return { error: "链接中没有可解析的 OTP，请粘贴 otpauth 链接或含 otp / secret / uri 参数的链接" };
      return OTP.otpInput.parse(location.raw, location.options);
    }
    return OTP.otpInput.parse(text);
  }
  async function bitmap(blob) {
    if (blob.size > 10 * 1024 * 1024) throw new Error("图片超过 10 MiB，请裁剪后重试");
    let result;
    try { result = await createImageBitmap(blob); } catch (_) { throw new Error("无法读取图片，请使用 PNG、JPG 或 WebP 图片"); }
    if (result.width * result.height > 24000000) { result.close(); throw new Error("图片超过 2400 万像素，请先裁剪二维码区域"); }
    return result;
  }
  async function decode(blob) {
    const source = await bitmap(blob);
    try {
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
      for (const size of [1600, 3200]) {
        const scale = Math.min(1, size / Math.max(source.width, source.height));
        canvas.width = Math.max(1, Math.round(source.width * scale));
        canvas.height = Math.max(1, Math.round(source.height * scale));
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = global.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) return code.data;
        if (scale === 1) break;
      }
      throw new Error("未识别到二维码，请保留二维码四周留白，或放大、重新框选后重试");
    } finally { source.close(); }
  }
  OTP.qr = { parse, decode, bitmap };
})(globalThis);
