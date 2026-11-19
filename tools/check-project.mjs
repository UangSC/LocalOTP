/* 发布前只读检查：版本、资源、文档链接及高置信凭据模式。不会输出命中的内容。 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { checkVersions } from "./version.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = name => readFileSync(resolve(root, name), "utf8");
const manifest = JSON.parse(read("manifest.json"));
checkVersions(root);
const id = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32)
  .replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
assert.equal(id, "mjpifhendkddjgmoheglnfciammaipji", "固定扩展公钥被改变");
const demo = JSON.parse(read("js/seed.js").match(/const DEMO = ([\s\S]*?);\s*\/\/ demo-data:end/)[1]);
const examples = [...demo.accounts, ...demo.imports];
assert.equal(demo.accounts.length, 10);
assert.equal(new Set(examples.map(account => account.secret)).size, examples.length, "演示密钥应彼此独立");
for (const account of examples) {
  assert.match(account.email, /^demo-[a-f0-9]+-\d+@example\.invalid$/, "演示邮箱必须不可投递");
  assert.ok(account.password.startsWith("PUBLIC-DEMO-"), "演示密码缺少公开测试标记");
  assert.match(account.secret, /^[A-Z2-7]{32}$/, "演示密钥格式不正确");
}
assert.equal(read("docs/examples/sync-test.txt"), demo.accounts.slice(0, 5).map(a => `${a.email}----${a.password}----${a.secret}`).join("\n") + "\n", "同步测试文件与演示批次不一致");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(name) : [name];
  });
}
for (const name of ["index.html", "popup.html", "api.html"]) {
  const source = read(name), scripts = [...source.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  assert.equal(scripts.length, new Set(scripts).size, name + " 重复加载脚本");
  for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|#|data:)/.test(match[1])) continue;
    assert.ok(existsSync(resolve(root, match[1])), name + " 缺少资源 " + match[1]);
  }
}
for (const name of walk(resolve(root, "js"))) {
  if (!name.endsWith(".js")) continue;
  const result = spawnSync(process.execPath, ["--check", name], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, relative(root, name) + " 语法错误：" + result.stderr);
}
const docs = [resolve(root, "README.md"), ...walk(resolve(root, "docs")).filter(name => name.endsWith(".md"))];
for (const file of docs) for (const match of readFileSync(file, "utf8").matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
  const link = match[1].split("#")[0];
  if (!link || /^[a-z]+:/i.test(link)) continue;
  assert.ok(existsSync(resolve(dirname(file), decodeURIComponent(link))), relative(root, file) + " 文档链接失效：" + link);
}

const patterns = {
  private_key: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  github_token: /(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})/,
  aws_access_key: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  slack_token: /xox[baprs]-[A-Za-z0-9-]{20,}/,
};
const findings = [];
function scan(name, source) {
  for (const [kind, pattern] of Object.entries(patterns)) if (pattern.test(source)) findings.push({ file: name, kind });
}
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))];
for (const name of files) {
  const path = resolve(root, name);
  if (!existsSync(path) || !statSync(path).isFile()) continue;
  assert.ok(!/^(?:dist|artifacts|node_modules)\//.test(name), "生成物被纳入版本控制：" + name);
  assert.ok(!/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12|har|db|sqlite)$|localotp-backup-.*\.json$/i.test(name), "不应提交的文件：" + name);
  if (/\.(?:js|mjs|py|json|md|html|css|txt)$/.test(name)) scan(name, readFileSync(path, "utf8"));
}
let historyBlobs = 0;
if (process.argv.includes("--history")) {
  const objects = execFileSync("git", ["rev-list", "--objects", "--all"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  for (const line of objects) {
    const space = line.indexOf(" "); if (space < 0) continue;
    const oid = line.slice(0, space), name = line.slice(space + 1);
    if (!/\.(?:js|mjs|py|json|md|html|css|txt)$/.test(name)) continue;
    scan("history:" + name, execFileSync("git", ["cat-file", "blob", oid], { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }));
    historyBlobs++;
  }
}
assert.deepEqual(findings, [], "发现疑似凭据；只报告位置和类型，不显示内容");
console.log(`版本 ${manifest.version}、固定 ID、资源、文档及凭据模式检查通过；当前 ${files.filter(name => existsSync(resolve(root, name))).length} 个文件，历史扫描 ${historyBlobs} 个文本对象。`);
console.log("模式扫描不能证明所有内容都无敏感信息；公开演示密钥与 RFC 向量不作为真实凭据判定。");
