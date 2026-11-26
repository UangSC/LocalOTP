/* ==========================================================================
   LocalOTP · seed
   公开生成的演示账号，仅使用不可投递的 example.invalid 域名；不得用于真实服务。
   ========================================================================== */

(function (global) {
  "use strict";

  const OTP = global.OTP;
  const uid = OTP.uid;

  const DEFAULT_CATEGORIES = [
    { id: "cat_google", name: "Google", icon: "brand-google" },
    { id: "cat_github", name: "GitHub", icon: "brand-github" },
    { id: "cat_chatgpt", name: "ChatGPT", icon: "brand-chatgpt" },
    { id: "cat_microsoft", name: "Microsoft", icon: "brand-microsoft" },
  ];

  const CATEGORIES = [
    { id: "cat_work", name: "工作", icon: "briefcase" },
    { id: "cat_play", name: "游戏", icon: "gamepad" },
    { id: "cat_shop", name: "购物", icon: "cart" },
    { id: "cat_dev", name: "开发", icon: "code" },
    { id: "cat_cloud", name: "云服务", icon: "cloud" },
    { id: "cat_bank", name: "金融", icon: "bank" },
  ];

  // demo-data:start
  const DEMO = {
    "batch": "3e81f542",
    "accounts": [
      {
        "email": "demo-3e81f542-01@example.invalid",
        "password": "PUBLIC-DEMO-Dt9i2U4-cspF!",
        "secret": "PB3PUORYJDEH6ZWJYRFCOUMSPBAW4NHW",
        "issuer": "Demo Source",
        "categoryId": "cat_dev",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-02@example.invalid",
        "password": "PUBLIC-DEMO-VjE5-sbdJFkF!",
        "secret": "2NDRULPDKJOT6G6GB56Z55TVR2AVKMYA",
        "issuer": "Demo Review",
        "categoryId": "cat_dev",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-03@example.invalid",
        "password": "PUBLIC-DEMO-b-WgHZDGZbkn!",
        "secret": "WFDTMIHBLILMNETCVV5JYCU5UW2Z7Q5L",
        "issuer": "Demo Mail",
        "categoryId": "cat_cloud",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-04@example.invalid",
        "password": "PUBLIC-DEMO-SEkDSF4qg_sW!",
        "secret": "XQZS7Y6D6XOKVPTEEAH5XFDJ4YGEUD4X",
        "issuer": "Demo Arcade",
        "categoryId": "cat_play",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-05@example.invalid",
        "password": "PUBLIC-DEMO-kUzckACvYOQo!",
        "secret": "M724FLE3DRG4HFN3LR2QE66VQGFNQ3XG",
        "issuer": "Demo Notes",
        "categoryId": "cat_work",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-06@example.invalid",
        "password": "PUBLIC-DEMO-Au9xmCfX9pCF!",
        "secret": "LAFDUVYBV24QUVU54NXXCH2PLP73RM67",
        "issuer": "Demo Design",
        "categoryId": "cat_work",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA256",
        "digits": 8,
        "period": 30
      },
      {
        "email": "demo-3e81f542-07@example.invalid",
        "password": "PUBLIC-DEMO-xqXGfCqn2Rg6!",
        "secret": "JMGXFF7A5RLKFHVAVMX2OYBRUJEXJYXB",
        "issuer": "Demo Cloud",
        "categoryId": "cat_cloud",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 60
      },
      {
        "email": "demo-3e81f542-08@example.invalid",
        "password": "PUBLIC-DEMO-hlCreEOFAeNd!",
        "secret": "VTZM2DA3D53KODI46QRCU23XDFC3LB7X",
        "issuer": "Demo Recovery",
        "categoryId": "cat_bank",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-09@example.invalid",
        "password": "PUBLIC-DEMO-f-BPayCManFm!",
        "secret": "DXV6A7NCD6VIY425NHYGGZF2CT6MGRFB",
        "issuer": "Demo Chat",
        "categoryId": "cat_play",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-10@example.invalid",
        "password": "PUBLIC-DEMO-gqG59UaWeOiL!",
        "secret": "KCXAWVFXNPIOZVX6WLXJMPVO65D34WEC",
        "issuer": "Demo Studio",
        "categoryId": "cat_work",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA512",
        "digits": 6,
        "period": 30
      }
    ],
    "imports": [
      {
        "email": "demo-3e81f542-11@example.invalid",
        "password": "PUBLIC-DEMO-Tbkh7xkduxTf!",
        "secret": "Q66A4GV5GZOXRLMNQ3NNBM2W4CKSIXLU",
        "issuer": "Demo Import",
        "categoryId": "",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-12@example.invalid",
        "password": "PUBLIC-DEMO-tYiMmYZkrt5E!",
        "secret": "YJIHEJYUDENJEGQJ3HXP5IQYMYJPOBTT",
        "issuer": "Demo Import",
        "categoryId": "",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      },
      {
        "email": "demo-3e81f542-13@example.invalid",
        "password": "PUBLIC-DEMO-30dtUgzdzlIM!",
        "secret": "HD5HKXVYELDADEC6FX7E7BFYY75YDA43",
        "issuer": "Demo Import",
        "categoryId": "",
        "note": "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      }
    ]
  };
  // demo-data:end

  function accounts(now) {
    const t0 = now || Date.now();
    return DEMO.accounts.map((r, i) => ({
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

  function defaultCategories() {
    // 固定初始时间戳 1：跨设备同步时任何编辑或删除都会自然胜出，不会复活已删默认分类。
    return DEFAULT_CATEGORIES.map((c) => ({ ...c, createdAt: 1, updatedAt: 1 }));
  }

  function categories() {
    const now = Date.now();
    return [
      ...CATEGORIES.map((c) => ({ ...c, createdAt: now, updatedAt: now })),
      ...defaultCategories(),
    ];
  }

  const line = account => `${account.email}----${account.password}----${account.secret}`;
  const SAMPLE_IMPORT = [
    ...DEMO.imports.slice(0, 2).map(line),
    line({ ...DEMO.accounts[0], password: DEMO.imports[0].password, secret: DEMO.imports[0].secret }),
    "invalid@example.invalid----PUBLIC-DEMO-INVALID----NOT_A_VALID_SECRET!",
    `otpauth://totp/Demo%20Import:${DEMO.imports[2].email}?secret=${DEMO.imports[2].secret}&issuer=Demo%20Import&digits=8`,
  ].join("\n");

  OTP.seed = { accounts, categories, defaultCategories, SAMPLE_IMPORT };
})(window);
