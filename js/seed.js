/* ==========================================================================
   LocalOTP · seed
   虚构演示账号：密钥全部是公开示例，邮箱域名只用 example / 通用域。
   ========================================================================== */

(function (global) {
  "use strict";

  const OTP = global.OTP;
  const uid = OTP.uid;

  const CATEGORIES = [
    { id: "cat_work", name: "工作", icon: "briefcase" },
    { id: "cat_play", name: "游戏", icon: "gamepad" },
    { id: "cat_shop", name: "购物", icon: "cart" },
    { id: "cat_dev", name: "开发", icon: "code" },
    { id: "cat_cloud", name: "云服务", icon: "cloud" },
    { id: "cat_bank", name: "金融", icon: "bank" },
  ];

  const RAW = [
    {
      email: "aurora.tang@example.com",
      password: "Aurora#Store2026!",
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "GitHub",
      categoryId: "cat_dev",
      note: "主力仓库，别删",
    },
    {
      email: "stack.dev+ci@example.com",
      password: "Ci!Bot#8890",
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      issuer: "GitLab",
      categoryId: "cat_dev",
    },
    {
      email: "hello@example.org",
      password: "Pr0ton!Mail",
      secret: "KRSXG5CTMVRXEZLU",
      issuer: "Proton Mail",
      categoryId: "cat_cloud",
    },
    {
      email: "q7.lab@example.com",
      password: "Steam!!7782",
      secret: "MFRGGZDFMZTWQ2LK",
      issuer: "Steam",
      categoryId: "cat_play",
      note: "家庭共享小号",
    },
    {
      email: "mika.wu@example.com",
      password: "MikaNotion_26",
      secret: "ONTXG3THMR2GK6LP",
      issuer: "Notion",
      categoryId: "cat_work",
    },
    {
      email: "trial.4821@example.com",
      password: "Figma$Trial",
      secret: "NBSWY3DPEB3W64TMMQ",
      issuer: "Figma",
      categoryId: "cat_work",
      algorithm: "SHA256",
      digits: 8,
    },
    {
      email: "robot@example.net",
      password: "Cf!Robot#2026",
      secret: "MZXW6YTBOI3W64TMMQ",
      issuer: "Cloudflare",
      categoryId: "cat_cloud",
      period: 60,
    },
    {
      email: "backup.only@example.com",
      password: "Backup#Only19",
      secret: "PFSXGIDNNF2G64TBM5SXG",
      issuer: "找回专用",
      categoryId: "cat_bank",
      note: "仅用于找回，勿在日常登录使用",
    },
    {
      email: "pixel.fern@example.com",
      password: "Pixel!Fern12",
      secret: "JBSWY3DPFQQFO33SNRSCC",
      issuer: "Discord",
      categoryId: "cat_play",
    },
    {
      email: "sora.ink@example.com",
      password: "SoraInk2026!",
      secret: "MZXW6YTBOI3W64TMMQ======",
      issuer: "Adobe",
      categoryId: "cat_work",
      algorithm: "SHA512",
    },
  ];

  function accounts(now) {
    const t0 = now || Date.now();
    return RAW.map((r, i) => ({
      id: uid("acc_"),
      email: r.email,
      password: r.password,
      secret: r.secret,
      issuer: r.issuer || "",
      note: r.note || "",
      categoryId: r.categoryId || "",
      algorithm: r.algorithm || "SHA1",
      digits: r.digits || 6,
      period: r.period || 30,
      createdAt: t0 - i * 1000 * 60 * 47,
      updatedAt: t0 - i * 1000 * 60 * 47,
    }));
  }

  function categories() {
    return CATEGORIES.map((c) => ({ ...c, createdAt: Date.now() }));
  }

  const SAMPLE_IMPORT = [
    "nova.wren@example.com----Nova#Store2026!----JBSWY3DPEHPK3PXP",
    "kai.tan@example.com----Kai!Tan#8890----GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    "aurora.tang@example.com----Replaced!2026----KRSXG5CTMVRXEZLU",
    "broken@example.com----pass123----JBSWY3DP1NVALID",
    "otpauth://totp/Vega%20Studio:vega@example.com?secret=NBSWY3DPEB3W64TMMQ&issuer=Vega%20Studio&digits=8",
  ].join("\n");

  OTP.seed = { accounts, categories, SAMPLE_IMPORT };
})(window);
