#!/usr/bin/env node
/* ==========================================================================
   LocalOTP · 自检
   --------------------------------------------------------------------------
   把浏览器端的 IIFE 模块放进一个最小沙箱里真实执行，验证：
     · RFC 4226 附录 D 的 HOTP 向量
     · RFC 6238 附录 B 的 TOTP 向量（SHA-1 / SHA-256 / SHA-512）
     · Base32 严格校验的边界
     · 批量导入解析（BOM / CRLF / 密码含 ---- / 同批与跨批去重 / otpauth）
     · 三种重复策略的写入结果
     · 管理密码摘要的往返校验
     · 备份合并、检索区间、同步合并的基础行为

   用法：node tools/selftest.mjs
   ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/* ── 极简浏览器沙箱 ─────────────────────────────────────────────────────── */

function makeSandbox() {
  const store = new Map();

  const sandbox = {
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Blob,
    btoa: (str) => Buffer.from(str, "binary").toString("base64"),
    atob: (str) => Buffer.from(str, "base64").toString("binary"),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    isSecureContext: true,
    navigator: {},
    location: { href: "http://localhost/" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  return sandbox;
}

function loadModule(sandbox, file) {
  const code = readFileSync(join(ROOT, "js", file), "utf8");
  vm.runInContext(code, sandbox, { filename: file });
}

/* ── 断言 ───────────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    return;
  }
  failures.push({ name, actual: a, expected: e });
}

function checkTrue(name, value) {
  check(name, !!value, true);
}

function section(title) {
  process.stdout.write(`\n\x1b[2m── ${title} ──\x1b[0m\n`);
}

/* ── Base32 / TOTP ──────────────────────────────────────────────────────── */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const ascii = (str) => new TextEncoder().encode(str);

const SECRET_SHA1 = base32Encode(ascii("12345678901234567890"));
const SECRET_SHA256 = base32Encode(ascii("12345678901234567890123456789012"));
const SECRET_SHA512 = base32Encode(
  ascii("1234567890123456789012345678901234567890123456789012345678901234")
);

const sandbox = makeSandbox();
loadModule(sandbox, "util.js");
loadModule(sandbox, "totp.js");
loadModule(sandbox, "qr-encode.js");
loadModule(sandbox, "seed.js");
loadModule(sandbox, "sync.js");
loadModule(sandbox, "store/security.js");
loadModule(sandbox, "store/search.js");
loadModule(sandbox, "store/import.js");
loadModule(sandbox, "store.js");

const OTP = sandbox.OTP;
const totp = OTP.totp;

/* ---- RFC 4226 附录 D ---- */

section("RFC 4226 附录 D · HOTP 6 位向量");

const HOTP_EXPECTED = [
  "755224", "287082", "359152", "969429", "338314",
  "254676", "287922", "162583", "399871", "520489",
];

for (let counter = 0; counter < HOTP_EXPECTED.length; counter++) {
  const code = await totp.hotp(SECRET_SHA1, { algorithm: "SHA1", digits: 6 }, counter);
  check(`HOTP counter=${counter}`, code, HOTP_EXPECTED[counter]);
}

/* ---- RFC 6238 附录 B ---- */

section("RFC 6238 附录 B · TOTP 8 位向量");

const TIMES = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];
const EXPECTED = {
  SHA1: ["94287082", "07081804", "14050471", "89005924", "69279037", "65353130"],
  SHA256: ["46119246", "68084774", "67062674", "91819424", "90698825", "77737706"],
  SHA512: ["90693936", "25091201", "99943326", "93441116", "38618901", "47863826"],
};
const SECRETS = { SHA1: SECRET_SHA1, SHA256: SECRET_SHA256, SHA512: SECRET_SHA512 };

for (const algo of ["SHA1", "SHA256", "SHA512"]) {
  for (let i = 0; i < TIMES.length; i++) {
    const counter = Math.floor(TIMES[i] / 30);
    const code = await totp.hotp(SECRETS[algo], { algorithm: algo, digits: 8 }, counter);
    check(`${algo} T=${TIMES[i]}`, code, EXPECTED[algo][i]);
  }
}

/* ---- Base32 严格校验 ---- */

section("Base32 校验边界");

check("小写 + 空格规范化", totp.validateSecret("jbswy3dp ehpk3pxp"), {
  ok: true,
  normalized: "JBSWY3DPEHPK3PXP",
  bytes: 10,
});
checkTrue("空密钥被拒", totp.validateSecret("").error === "密钥不能为空");
checkTrue("非法字符被拒", totp.validateSecret("JBSWY3DP1NPUT").ok === false);
checkTrue("长度 %8==1 被拒", totp.validateSecret("JBSWY3DPX").ok === false);
checkTrue("填充位置非法被拒", totp.validateSecret("MZXW6YTB=======").ok === false);
checkTrue("填充在中间被拒", totp.validateSecret("MZXW6=YTB").ok === false);
check("合法填充被接受", totp.validateSecret("MZXW6YTBOI3W64TMMQ======").ok, true);
// 容易误判的对照：SHA256INVALID 里没有 0/1/8/9，所以它其实是合法 Base32
check("SHA256INVALID 是合法 Base32", totp.validateSecret("SHA256INVALID").ok, true);

/* ---- 时间片 ---- */

section("TOTP 时间片");

const cycle = totp.cycle(30, 60_500);
check("周期 30 在 60.5s 的计数器", cycle.counter, 2);
check("剩余秒数", Math.round(cycle.remaining * 10) / 10, 29.5);
check("进度", Math.round(cycle.progress * 1000) / 1000, 0.017);

/* ---- otpauth ---- */

section("otpauth:// 解析");

const uri =
  "otpauth://totp/Vega%20Studio:vega@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Vega%20Studio&digits=8&period=60&algorithm=SHA256";
const parsed = totp.parseOtpauth(uri);
check("issuer", parsed.issuer, "Vega Studio");
check("email", parsed.email, "vega@example.com");
check("secret", parsed.secret, "JBSWY3DPEHPK3PXP");
check("digits", parsed.digits, 8);
check("period", parsed.period, 60);
check("algorithm", parsed.algorithm, "SHA256");
check("hotp 被明确拒绝", totp.parseOtpauth("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP").error, "暂不支持 hotp（基于计数器）");
check("非法密钥被拒", totp.parseOtpauth("otpauth://totp/x?secret=!!!").error.startsWith("链接里的密钥无效"), true);

/* ── 导入解析 ───────────────────────────────────────────────────────────── */

section("批量导入解析");

await OTP.store.init();

const importText = [
  "\uFEFFfirst@example.com----Pass$word----JBSWY3DPEHPK3PXP",
  "crlf@example.com----has----dashes----GEZDGNBVGY3TQOJQ",
  "",
  "  spaced@example.com  ----  spaces kept  ----  jbswy3dpehpk3pxp  ",
  "nouveau@example.com----pw----NOT_A_BASE32!",
  "first@example.com----second----KRSXG5CTMVRXEZLU",
  "otpauth://totp/Work:otp@example.com?secret=NBSWY3DPEB3W64TMMQ&issuer=Work",
].join("\r\n");

const result = OTP.store.parseImport(importText);
check("总行数（空行跳过）", result.stats.total, 6);
check("可新增", result.stats.fresh, 4);
check("重复", result.stats.dup, 1);
check("无效", result.stats.bad, 1);

check("BOM 被剥掉，邮箱干净", result.rows[0].email, "first@example.com");
check("密码里的 ---- 原样保留", result.rows[1].password, "has----dashes");
check("空格被原样保留在密码里", result.rows[2].password, "  spaces kept  ");
check("密钥被规范化", result.rows[2].secret, "JBSWY3DPEHPK3PXP");
check("非法密钥给出原因", result.rows[3].kind, "bad");
check("同批重复只标记后出现的", result.rows[4].reason, "同一批次内重复");
check("先出现的仍算新增", result.rows[0].kind, "new");
check("otpauth 行被识别", result.rows[5].secret, "NBSWY3DPEB3W64TMMQ");
check("otpauth 的 issuer", result.rows[5].issuer, "Work");

/* ---- 三种重复策略 ---- */

section("导入写入结果");

const freshOnly = OTP.store.applyImport(result.rows, "skip");
check("skip 只写新增", freshOnly.added, 4);

const keepAll = OTP.store.applyImport(result.rows, "keep");
check("keep 把重复项也写成独立账号", keepAll.added, 5);

const before = OTP.store.accounts().find((a) => a.email === "first@example.com");
const replaced = OTP.store.applyImport(
  [{ line: 1, kind: "dup", email: "first@example.com", password: "newpass", secret: "KRSXG5CTMVRXEZLU", algorithm: "SHA1", digits: 6, period: 30, dupOf: before.id }],
  "replace"
);
check("replace 命中已有账号", replaced.replaced, 1);
check(
  "replace 后密码被改写",
  OTP.store.accounts().find((a) => a.email === "first@example.com").password,
  "newpass"
);

/* ── 快速添加（小窗的一行式解析）────────────────────────────────────────── */

section("快速添加解析");

const quick = OTP.store.parseQuick(
  [
    "dash.two@example.com--Dp#2026--JBSWY3DPEHPK3PXP",
    "tab@example.com\tTb#2026\tKRSXG5CTMVRXEZLU",
    "pipe@example.com | Pp#2026 | MFRGGZDFMZTWQ2LK",
    "dash.heavy@example.com----Pa--ss----GEZDGNBVGY3TQOJQ",
    "这一行没有分隔符",
    "dash.two@example.com--again--NBSWY3DPEB3W64TMMQ",
  ].join("\n")
);

check("六行统计", quick.stats, { total: 6, fresh: 4, dup: 1, bad: 1 });
check("`--` 分隔的密码原样保留", quick.rows[0].password, "Dp#2026");
check("Tab 分隔可用", quick.rows[1].secret, "KRSXG5CTMVRXEZLU");
check("`|` 分隔可用", quick.rows[2].secret, "MFRGGZDFMZTWQ2LK");
check("密码里含 -- 时用 ---- 保住", quick.rows[3].password, "Pa--ss");
check("认不出分隔符时给出原因", quick.rows[4].kind, "bad");
check("同批重复只标后出现的", quick.rows[5].reason, "同一批次内重复");

const quickOtp = OTP.store.parseQuick(
  [
    "otpauth://totp/GitHub:alice.quick@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60",
    "otpauth://totp/Dup:alice.quick@example.com?secret=KRSXG5CTMVRXEZLU",
    "otpauth://hotp/Bad:x?secret=JBSWY3DPEHPK3PXP",
    "MFRGGZDFMZTWQ2LL",
  ].join("\n")
);
check("快速添加支持 otpauth 链接与纯密钥", quickOtp.stats, { total: 4, fresh: 2, dup: 1, bad: 1 });
check("快速添加解析 otpauth 参数", [quickOtp.rows[0].issuer, quickOtp.rows[0].email, quickOtp.rows[0].algorithm, quickOtp.rows[0].digits, quickOtp.rows[0].period], ["GitHub", "alice.quick@example.com", "SHA256", 8, 60]);
check("快速添加识别纯 Base32 密钥", quickOtp.rows[3].secret, "MFRGGZDFMZTWQ2LL");

/* ── 门禁摘要 ───────────────────────────────────────────────────────────── */

section("管理密码摘要");

await OTP.store.setPassword("2FA2026");
checkTrue("正确密码通过", await OTP.store.verifyPassword("2FA2026"));
checkTrue("错误密码被拒", (await OTP.store.verifyPassword("2fa2026")) === false);
check("摘要算法", OTP.store.securityInfo().algorithm, "PBKDF2-SHA256");
checkTrue("摘要里没有明文密码", JSON.stringify(OTP.store.state.security).includes("2FA2026") === false);

/* ── 检索 ───────────────────────────────────────────────────────────────── */

section("检索");

// 回到一个干净的集合，避免前面几轮导入把命中数变得难以断言
OTP.store.resetDemo();
OTP.store.createAccount({
  email: "solo.marker@example.com",
  password: "pw",
  secret: "JBSWY3DPEHPK3PXP",
  issuer: "Solo",
  note: "",
});

const byEmail = OTP.store.search("solo.marker@");
check("邮箱命中数", byEmail.hits.length, 1);
check("命中区间", byEmail.hits[0].ranges.email[0], [0, 12]);

const byIssuer = OTP.store.search("DEMO NOTES");
checkTrue("服务名大小写不敏感", byIssuer.hits.length >= 1);
checkTrue("命中落在服务名区间", byIssuer.hits[0].ranges.issuer.length > 0);

const codeSearch = OTP.store.search("123", {
  codes: new Map(OTP.store.accounts().map((a) => [a.id, "123456"])),
});
check("按验证码数字检索", codeSearch.hits.length, OTP.store.accounts().length);

/* ── 备份 ───────────────────────────────────────────────────────────────── */

section("备份合并");

const backup = OTP.store.exportPayload();
check("备份格式", backup.format, "localotp.backup");
check("备份版本", backup.version, 2);

const countBefore = OTP.store.accounts().length;
const merged = OTP.store.importPayload(backup);
check("同一份备份不会重复写入", merged.added, 0);
check("全部被判为已存在", merged.skipped, backup.accounts.length);
check("账号数不变", OTP.store.accounts().length, countBefore);

const extra = {
  format: "localotp.backup",
  version: 2,
  accounts: [
    { email: "new.one@example.com", password: "pw", secret: "JBSWY3DPEHPK3PXP", updatedAt: Date.now() },
    { email: "bad.one@example.com", password: "pw", secret: "!!!!", updatedAt: Date.now() },
  ],
};
const added = OTP.store.importPayload(extra);
check("只合并合法且有意义的记录", added.added, 1);
check("非法密钥被跳过", added.skipped, 1);

/* ── 排序 ───────────────────────────────────────────────────────────────── */

section("排序");

const sortedByEmail = OTP.store.sortAccounts(OTP.store.accounts(), "email");
const emails = sortedByEmail.map((a) => a.email);
check("邮箱排序单调", JSON.stringify(emails) === JSON.stringify([...emails].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))), true);

section("字母头像");
check("驼峰服务名", OTP.initials("a@example.com", "GitHub"), "GH");
check("邮件服务不用图标", OTP.initials("a@example.com", "Proton Mail"), "PM");
check("中文服务回退邮箱", OTP.initials("backup.only@example.com", "找回专用"), "BO");
check("纯数字账号回退域名字母", OTP.initials("123@example.com", "测试"), "EC");
check("无拉丁字母使用稳定默认", OTP.initials("123@测试", "测试"), "AC");
check("连续大写服务名称", OTP.initials("a@example.com", "AWS"), "AW");

section("自定义 OTP 周期持久化");
const customPeriodRows = OTP.store.parseImport("otpauth://totp/Custom:period@example.com?secret=JBSWY3DPEHPK3PXP&period=45&digits=8&algorithm=SHA256");
check("导入保留自定义 45 秒", customPeriodRows.rows[0].period, 45);
OTP.store.applyImport(customPeriodRows.rows, "skip");
check("账号正规化不静默改成 30 秒", OTP.store.accounts().find(a => a.email === "period@example.com").period, 45);
await OTP.store.persist();
await OTP.store.init();
check("持久化重读保留周期", OTP.store.accounts().find(a => a.email === "period@example.com").period, 45);
check("损坏的 otpauth 标签被标记无效而不抛异常", OTP.store.parseImport("otpauth://totp/%FF?secret=JBSWY3DPEHPK3PXP").stats.bad, 1);

section("纯 OTP 导入与无邮箱备份");
const onlyOtpRows = OTP.store.parseImport("JBSWY3DPEHPK3PXQ\nJBSWY3DPEHPK3PXR");
check("两条纯密钥均可导入", onlyOtpRows.stats.fresh, 2);
OTP.store.applyImport(onlyOtpRows.rows, "skip");
check("重复纯密钥正确识别", OTP.store.parseImport("JBSWY3DPEHPK3PXQ").stats.dup, 1);
check("空邮箱备份按不同密钥区分", OTP.store.importPayload({accounts:[
  {id:'only-otp-one',email:'',secret:'JBSWY3DPEHPK3PXS'},
  {id:'only-otp-two',email:'',secret:'JBSWY3DPEHPK3PXT'},
]}).added, 2);
await OTP.store.persist(); await OTP.store.init();
check("纯 OTP 持久化保留空邮箱与空密码", OTP.store.accounts().filter(a=>!a.email&&!a.password).length, 4);

section("OTP 链接构建、离线 QR 编码与默认分类");
const builtUri = totp.buildOtpauth({
  email: "alice@example.com",
  issuer: "GitHub",
  secret: "JBSWY3DPEHPK3PXP",
  algorithm: "SHA256",
  digits: 8,
  period: 60,
});
const roundTrip = totp.parseOtpauth(builtUri);
check("buildOtpauth 往返 issuer 一致", roundTrip.issuer, "GitHub");
check("buildOtpauth 往返 email 一致", roundTrip.email, "alice@example.com");
check("buildOtpauth 往返 secret 一致", roundTrip.secret, "JBSWY3DPEHPK3PXP");
check("buildOtpauth 往返 algorithm/digits/period 一致", [roundTrip.algorithm, roundTrip.digits, roundTrip.period], ["SHA256", 8, 60]);
const qrMatrix = OTP.qrEncode.encodeMatrix(builtUri);
checkTrue("离线 QR 矩阵为标准合法尺寸", Array.isArray(qrMatrix) && qrMatrix.length >= 21 && (qrMatrix.length - 17) % 4 === 0);
check("默认平台分类齐全", OTP.seed.defaultCategories().map(c => c.name), ["Google", "GitHub", "ChatGPT", "Microsoft"]);

/* ── 结果 ───────────────────────────────────────────────────────────────── */

process.stdout.write("\n");
if (failures.length) {
  for (const failure of failures) {
    process.stdout.write(`\x1b[31m✗ ${failure.name}\x1b[0m\n  actual  : ${failure.actual}\n  expected: ${failure.expected}\n`);
  }
  process.stdout.write(`\n\x1b[31m${failures.length} 项失败\x1b[0m，${passed} 项通过\n`);
  process.exit(1);
}

process.stdout.write(`\x1b[32m✓ 全部 ${passed} 项通过\x1b[0m\n`);
