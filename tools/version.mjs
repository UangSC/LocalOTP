/* manifest.json 是产品版本的唯一来源；同步衍生文件，校验发布标签。零外部依赖。 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (root, name) => readFileSync(resolve(root, name), "utf8");
const normalizeLines = source => source.replace(/\r\n/g, "\n");

export function validateVersion(version) {
  assert.equal(typeof version, "string", "版本号必须是字符串");
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "版本号必须为三位数字，如 1.0.0，不使用前导零");
  const parts = version.split(".").map(Number);
  assert.ok(parts.every(part => part <= 65535) && parts.some(part => part > 0), "版本号各段须在 0–65535 之间，不能全为零");
  return version;
}

export function readVersion(root = projectRoot) {
  return validateVersion(JSON.parse(read(root, "manifest.json")).version);
}

export function renderVersionScript(version) {
  validateVersion(version);
  return `/* 由 tools/version.mjs 根据 manifest.json 生成；请勿手工修改。 */
(function (global) {
  "use strict";
  const OTP = global.OTP || (global.OTP = {});
  const previewVersion = ${JSON.stringify(version)};
  Object.defineProperty(OTP, "version", {
    enumerable: true,
    configurable: true,
    get() { return global.chrome?.runtime?.getManifest?.().version || previewVersion; },
  });
})(globalThis);
`;
}

function synchronizeReadme(source, version) {
  assert.equal([...source.matchAll(/当前版本：\d+\.\d+\.\d+/g)].length, 1, "README 必须有且仅有一处当前版本声明");
  assert.match(source, /dist\/LocalOTP-\d+\.\d+\.\d+\.zip/, "README 缺少正式打包产物路径");
  return source
    .replace(/(当前版本：)\d+\.\d+\.\d+/, `$1${version}`)
    .replace(/LocalOTP-\d+\.\d+\.\d+\.zip/g, `LocalOTP-${version}.zip`)
    .replace(/(https:\/\/github\.com\/UangSC\/LocalOTP\/releases\/(?:download|tag)\/v)\d+\.\d+\.\d+(?:\/LocalOTP-\d+\.\d+\.\d+\.zip(?:\.sha256)?)?/g, match =>
      match.replace(/v\d+\.\d+\.\d+/, `v${version}`).replace(/LocalOTP-\d+\.\d+\.\d+\.zip/, `LocalOTP-${version}.zip`))
    .replace(/(docs\/releases\/)\d+\.\d+\.\d+(\.md)/g, `$1${version}$2`);
}

function planSynchronization(root, version) {
  const packageSource = read(root, "package.json");
  const pkg = JSON.parse(packageSource);
  assert.equal(typeof pkg.version, "string", "package.json 缺少版本号");
  const nextPackage = packageSource.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, `$1${version}$2`);
  assert.equal(JSON.parse(nextPackage).version, version, "无法同步 package.json 版本号");
  return [
    ["package.json", nextPackage],
    ["README.md", synchronizeReadme(read(root, "README.md"), version)],
    ["js/version.js", renderVersionScript(version)],
  ];
}

export function syncVersions(root = projectRoot) {
  const version = readVersion(root);
  for (const [name, source] of planSynchronization(root, version)) {
    if (!existsSync(resolve(root, name)) || normalizeLines(read(root, name)) !== normalizeLines(source)) {
      writeFileSync(resolve(root, name), source);
    }
  }
  return version;
}

export function setVersion(version, root = projectRoot) {
  validateVersion(version);
  const currentVersion = readVersion(root);
  const currentParts = currentVersion.split(".").map(Number);
  const nextParts = version.split(".").map(Number);
  const changedPart = nextParts.findIndex((part, index) => part !== currentParts[index]);
  assert.ok(changedPart < 0 || nextParts[changedPart] > currentParts[changedPart], "正式版本只能递增，不能从 " + currentVersion + " 重置为 " + version);
  const manifestSource = read(root, "manifest.json");
  const updates = planSynchronization(root, version);
  const nextManifest = manifestSource.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, `$1${version}$2`);
  assert.equal(JSON.parse(nextManifest).version, version, "无法修改 manifest.json 版本号");
  for (const [name, source] of [["manifest.json", nextManifest], ...updates]) writeFileSync(resolve(root, name), source);
  return version;
}

export function checkVersions(root = projectRoot) {
  const version = readVersion(root);
  assert.equal(JSON.parse(read(root, "package.json")).version, version, "package.json 版本与 manifest 不一致，请运行 npm run version:sync");
  const readme = read(root, "README.md");
  const declarations = [...readme.matchAll(/当前版本：(\d+\.\d+\.\d+)/g)];
  assert.equal(declarations.length, 1, "README 必须有且仅有一处当前版本声明");
  assert.equal(declarations[0][1], version, "README 当前版本与 manifest 不一致");
  assert.match(readme, /dist\/LocalOTP-\d+\.\d+\.\d+\.zip/, "README 缺少正式打包产物路径");
  const packages = [...readme.matchAll(/LocalOTP-(\d+\.\d+\.\d+)\.zip/g)];
  for (const match of packages) assert.equal(match[1], version, "README 正式包名与 manifest 不一致");
  for (const match of readme.matchAll(/https:\/\/github\.com\/UangSC\/LocalOTP\/releases\/(?:download|tag)\/v(\d+\.\d+\.\d+)/g)) {
    assert.equal(match[1], version, "README 当前发布链接与 manifest 不一致");
  }
  assert.equal(normalizeLines(read(root, "js/version.js")), renderVersionScript(version), "网页预览版本过期，请运行 npm run version:sync");
  for (const name of ["index.html", "popup.html", "api.html"]) {
    const scripts = [...read(root, name).matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
    assert.equal(scripts[0], "js/version.js", name + " 必须先加载统一版本脚本");
    assert.equal(scripts.filter(script => script === "js/version.js").length, 1, name + " 重复加载版本脚本");
  }
  const footers = [...read(root, "js/sheets/settings.js").matchAll(/text:\s*`LocalOTP \$\{([^}]*)\}[^`]*`/g)];
  assert.equal(footers.length, 1, "设置页必须使用唯一的统一版本页脚");
  assert.equal(footers[0][1], "OTP.version", "设置页必须通过 OTP.version 显示版本，不能硬编码回退值");
  return version;
}

export function checkReleaseTag(tag, root = projectRoot) {
  const version = checkVersions(root);
  assert.equal(tag, `v${version}`, "发布标签须与 manifest 版本一致，如 v1.0.0");
  assert.ok(existsSync(resolve(root, "docs", "releases", `${version}.md`)), "缺少当前版本发布说明：docs/releases/" + version + ".md");
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  assert.equal(git(["rev-parse", `refs/tags/${tag}^{commit}`]), git(["rev-parse", "HEAD"]), "发布标签未指向当前提交，拒绝从不同源码生成下载包");
  assert.equal(git(["status", "--porcelain", "--untracked-files=normal"]), "", "工作区存在未提交文件，发布包必须从标签对应的干净源码生成");
  return version;
}

function main(args) {
  if (!args.length || args.length === 1 && args[0] === "--check") {
    console.log(`版本 ${checkVersions()}：manifest、package、README、网页预览与页面加载顺序一致。`);
  } else if (args.length === 1 && args[0] === "--sync") {
    console.log(`已按 manifest 同步版本 ${syncVersions()}。`);
  } else if (args.length === 2 && args[0] === "--set") {
    console.log(`已设置并同步版本 ${setVersion(args[1])}。`);
  } else if (args.length === 2 && args[0] === "--check-tag") {
    console.log(`发布 ${checkReleaseTag(args[1])}：标签、当前提交与发布说明一致。`);
  } else if (args.length === 1 && args[0] === "--help") {
    console.log("用法：node tools/version.mjs [--check | --sync | --set 1.0.1 | --check-tag v1.0.0]\n--check 检查版本；--sync 同步衍生文件；--set 修改唯一版本源并同步；--check-tag 校验发布标签与当前提交。");
  } else {
    throw new Error("参数不正确；请运行 node tools/version.mjs --help 查看用法。");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
