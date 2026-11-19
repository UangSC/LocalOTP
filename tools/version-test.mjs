/* 版本和发布守卫的隔离回归：所有文件与 Git 操作都在 artifacts 的临时夹具中。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  projectRoot, readVersion, validateVersion, renderVersionScript,
  syncVersions, setVersion, checkVersions, checkReleaseTag,
} from "./version.mjs";

function createFixture(context, derivedVersion = "0.9.0") {
  const base = resolve(projectRoot, "artifacts");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "version-test-"));
  context.after(() => {
    assert.equal(dirname(root), base, "只清理当前测试创建的夹具目录");
    rmSync(root, { recursive: true, force: true });
  });
  const write = (name, source) => writeFileSync(join(root, name), source);
  const read = name => readFileSync(join(root, name), "utf8");
  mkdirSync(join(root, "js"));
  mkdirSync(join(root, "js", "sheets"));
  mkdirSync(join(root, "docs", "releases"), { recursive: true });
  write("manifest.json", JSON.stringify({ version: "1.0.0" }));
  write("package.json", JSON.stringify({ name: "version-fixture", version: derivedVersion }));
  write("README.md", [
    `**当前版本：${derivedVersion}（正式版）。**`,
    `正式打包产物为 \`dist/LocalOTP-${derivedVersion}.zip\`。`,
    `[LocalOTP-${derivedVersion}.zip](https://github.com/UangSC/LocalOTP/releases/download/v${derivedVersion}/LocalOTP-${derivedVersion}.zip)`,
    `[校验](https://github.com/UangSC/LocalOTP/releases/download/v${derivedVersion}/LocalOTP-${derivedVersion}.zip.sha256)`,
    `[发布](https://github.com/UangSC/LocalOTP/releases/tag/v${derivedVersion})`,
    `[说明](docs/releases/${derivedVersion}.md)`,
    "历史编号为 1.6.1；账号格式 v2 与产品版本独立。",
    "",
  ].join("\n"));
  write("js/version.js", renderVersionScript(derivedVersion));
  write("js/sheets/settings.js", 'const footer = { text: `LocalOTP ${OTP.version} · 本地存储` };\n');
  for (const page of ["index.html", "popup.html", "api.html"]) {
    write(page, '<script src="js/version.js"></script>\n<script src="js/util.js"></script>\n');
  }
  const gitEnvironment = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete gitEnvironment[name];
  const git = args => execFileSync("git", args, {
    cwd: root, env: gitEnvironment, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  }).trim();
  const initializeGit = () => {
    mkdirSync(join(root, "empty-hooks"));
    git(["init", "-q"]);
    git(["config", "user.name", "Version Test"]);
    git(["config", "user.email", "version@example.invalid"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "tag.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);
    git(["config", "core.hooksPath", join(root, "empty-hooks")]);
    write(".gitignore", "/dist/\n");
    git(["add", "."]);
    git(["commit", "-qm", "创建隔离版本夹具"]);
    git(["tag", "v1.0.0"]);
  };
  return { root, write, read, git, initializeGit };
}

await test("manifest 同步所有当前版本声明、下载链接与预览，保留历史编号和数据版本", context => {
  const fixture = createFixture(context);
  assert.equal(syncVersions(fixture.root), "1.0.0");
  assert.equal(readVersion(fixture.root), "1.0.0");
  assert.equal(checkVersions(fixture.root), "1.0.0");
  const readme = fixture.read("README.md");
  for (const expected of [
    "当前版本：1.0.0", "dist/LocalOTP-1.0.0.zip",
    "[LocalOTP-1.0.0.zip]", "/download/v1.0.0/LocalOTP-1.0.0.zip.sha256",
    "/tag/v1.0.0", "docs/releases/1.0.0.md", "历史编号为 1.6.1", "账号格式 v2",
  ]) assert.ok(readme.includes(expected), "缺少同步或应保留的声明：" + expected);
  const before = fixture.read("README.md");
  syncVersions(fixture.root);
  assert.equal(fixture.read("README.md"), before, "重复同步不应产生差异");
});

await test("设置版本同步衍生文件；无效版本或错误 README 在写入前被拒绝", context => {
  const fixture = createFixture(context, "1.0.0");
  assert.equal(setVersion("1.0.1", fixture.root), "1.0.1");
  assert.equal(readVersion(fixture.root), "1.0.1");
  assert.equal(checkVersions(fixture.root), "1.0.1");
  const names = ["manifest.json", "package.json", "README.md", "js/version.js"];
  const before = names.map(name => fixture.read(name));
  assert.throws(() => setVersion("1.0.1-beta", fixture.root), /三位数字/);
  assert.deepEqual(names.map(name => fixture.read(name)), before);
  fixture.write("README.md", "缺少当前版本声明。\n");
  const broken = names.map(name => fixture.read(name));
  assert.throws(() => setVersion("1.0.2", fixture.root), /README/);
  assert.deepEqual(names.map(name => fixture.read(name)), broken, "预检查失败不能部分更新版本源");
});

await test("网页使用生成版本，插件优先显示实际运行时 manifest 版本", () => {
  const preview = { OTP: { existing: true } };
  vm.runInNewContext(renderVersionScript("1.0.0"), preview);
  assert.equal(preview.OTP.version, "1.0.0");
  assert.equal(preview.OTP.existing, true);
  let runtimeVersion = "1.0.9";
  const extension = { chrome: { runtime: { getManifest: () => ({ version: runtimeVersion }) } } };
  vm.runInNewContext(renderVersionScript("1.0.0"), extension);
  assert.equal(extension.OTP.version, "1.0.9");
  runtimeVersion = "1.1.0";
  assert.equal(extension.OTP.version, "1.1.0");
});

await test("正式版本按数字递增，允许相等同步，拒绝重置为较小版本", context => {
  const fixture = createFixture(context, "1.0.0");
  assert.equal(setVersion("1.0.0", fixture.root), "1.0.0");
  assert.equal(setVersion("1.0.10", fixture.root), "1.0.10");
  const names = ["manifest.json", "package.json", "README.md", "js/version.js"];
  const before = names.map(name => fixture.read(name));
  for (const older of ["1.0.2", "1.0.0", "0.65535.65535"]) {
    assert.throws(() => setVersion(older, fixture.root), /正式版本只能递增/);
    assert.deepEqual(names.map(name => fixture.read(name)), before);
  }
  assert.equal(setVersion("1.0.10", fixture.root), "1.0.10");
  assert.equal(setVersion("1.1.0", fixture.root), "1.1.0");
  assert.equal(setVersion("2.0.0", fixture.root), "2.0.0");
  assert.equal(checkVersions(fixture.root), "2.0.0");
});

await test("版本格式遵守三段数字与 Chromium 范围", () => {
  for (const version of ["1.0.0", "0.1.0", "65535.65535.65535"]) assert.equal(validateVersion(version), version);
  for (const version of [undefined, 1, "1.0", "01.0.0", "1.0.0-beta", "65536.0.0", "0.0.0"]) {
    assert.throws(() => validateVersion(version), undefined, "应拒绝版本：" + String(version));
  }
});

await test("检查拒绝旧版本、重复声明、过期生成文件及错误下载链接", context => {
  const cases = [
    ["package 旧版本", fixture => fixture.write("package.json", '{"version":"1.6.1"}'), /package/],
    ["README 当前版本", fixture => fixture.write("README.md", fixture.read("README.md").replace("当前版本：1.0.0", "当前版本：1.6.1")), /README 当前版本/],
    ["README 重复声明", fixture => fixture.write("README.md", fixture.read("README.md") + "当前版本：1.0.0\n"), /有且仅有/],
    ["README 缺少声明", fixture => fixture.write("README.md", fixture.read("README.md").replace("当前版本：1.0.0", "产品版本：1.0.0")), /有且仅有/],
    ["README 旧包名", fixture => fixture.write("README.md", fixture.read("README.md").replace("dist/LocalOTP-1.0.0.zip", "dist/LocalOTP-1.6.1.zip")), /正式包名/],
    ["README 旧发布链接", fixture => fixture.write("README.md", fixture.read("README.md").replace("/tag/v1.0.0", "/tag/v1.6.1")), /发布链接/],
    ["预览生成版本", fixture => fixture.write("js/version.js", renderVersionScript("1.6.1")), /网页预览版本过期/],
    ["设置页硬编码回退值", fixture => fixture.write("js/sheets/settings.js", fixture.read("js/sheets/settings.js").replace("OTP.version", '"1.6.1"')), /不能硬编码回退值/],
  ];
  for (const [label, mutate, expected] of cases) {
    const fixture = createFixture(context, "1.0.0");
    mutate(fixture);
    assert.throws(() => checkVersions(fixture.root), expected, label);
  }
});

await test("三个页面必须首先且仅加载一次版本脚本", context => {
  for (const page of ["index.html", "popup.html", "api.html"]) {
    const fixture = createFixture(context, "1.0.0");
    fixture.write(page, '<script src="js/util.js"></script>\n<script src="js/version.js"></script>');
    assert.throws(() => checkVersions(fixture.root), /必须先加载/, page);
    fixture.write(page, '<script src="js/version.js"></script>\n<script src="js/version.js"></script>');
    assert.throws(() => checkVersions(fixture.root), /重复加载/, page);
  }
});

await test("发布拒绝版本错误的标签与缺失发布说明", context => {
  const fixture = createFixture(context, "1.0.0");
  assert.throws(() => checkReleaseTag("v1.6.1", fixture.root), /发布标签须/);
  assert.throws(() => checkReleaseTag("v1.0.0", fixture.root), /缺少当前版本发布说明/);
});

await test("标签对应干净源码通过；不同 HEAD、未提交和暂存修改被拒绝", context => {
  const fixture = createFixture(context, "1.0.0");
  fixture.write("docs/releases/1.0.0.md", "# 1.0.0\n");
  fixture.initializeGit();
  assert.equal(checkReleaseTag("v1.0.0", fixture.root), "1.0.0");
  mkdirSync(join(fixture.root, "dist"));
  fixture.write("dist/ignored.txt", "打包产物由 Git 忽略\n");
  assert.equal(checkReleaseTag("v1.0.0", fixture.root), "1.0.0");
  fixture.write("uncommitted.txt", "新增源码\n");
  assert.throws(() => checkReleaseTag("v1.0.0", fixture.root), /工作区存在未提交文件/);
  fixture.git(["add", "uncommitted.txt"]);
  assert.throws(() => checkReleaseTag("v1.0.0", fixture.root), /工作区存在未提交文件/);
  fixture.git(["commit", "-qm", "增加源码而不移动标签"]);
  assert.throws(() => checkReleaseTag("v1.0.0", fixture.root), /发布标签未指向当前提交/);
});

await test("导入版本模块不会执行命令行，也不会修改真实 manifest", () => {
  const before = readFileSync(join(projectRoot, "manifest.json"), "utf8");
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", 'import "./tools/version.mjs";'], {
    cwd: projectRoot, encoding: "utf8", windowsHide: true,
  });
  assert.equal(output, "");
  assert.equal(readFileSync(join(projectRoot, "manifest.json"), "utf8"), before);
});
