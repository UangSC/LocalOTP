/* 生成 GitHub Pages 静态发布目录：仅打包 api.html 及其直接引用的样式、脚本和图标。 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArgIndex = process.argv.indexOf("--out");
const outDir = resolve(root, outArgIndex >= 0 && process.argv[outArgIndex + 1] ? process.argv[outArgIndex + 1] : "_site");

const apiHtmlPath = resolve(root, "api.html");
const apiHtml = readFileSync(apiHtmlPath, "utf8");
const brandTarget = '<a class="api-brand" href="index.html" aria-label="打开 LocalOTP 账号管理">';
assert.ok(apiHtml.includes(brandTarget), "api.html 缺少预期的品牌入口链接，无法改写为 GitHub 仓库链接");
const pagesHtml = apiHtml.replace(
  brandTarget,
  '<a class="api-brand" href="https://github.com/UangSC/LocalOTP" target="_blank" rel="noopener noreferrer" aria-label="访问 LocalOTP GitHub 仓库">'
);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 根路径直接打开即呈现 API 临时验证码页面，同时保留 api.html 路径兼容。
writeFileSync(resolve(outDir, "index.html"), pagesHtml, "utf8");
writeFileSync(resolve(outDir, "api.html"), pagesHtml, "utf8");
writeFileSync(resolve(outDir, ".nojekyll"), "", "utf8");

// 仅收集 <link href="..."> / <script src="..."> 引用的静态资源，绝不复制 *.html 扩展页面。
const refs = new Set();
for (const match of pagesHtml.matchAll(/<(?:link|script)\b[^>]*\b(?:src|href)="([^"]+)"/gi)) {
  const ref = match[1];
  if (/^(https?:|#|data:)/i.test(ref)) continue;
  if (!/^(?:js|styles|assets)\//i.test(ref) || /\.html?$/i.test(ref)) {
    throw new Error(`拒绝打包非静态资源或 HTML 页面引用：${ref}`);
  }
  refs.add(ref);
}

for (const rel of refs) {
  const src = resolve(root, rel);
  if (!existsSync(src)) {
    throw new Error(`api.html 引用的资源不存在：${rel}`);
  }
  const dest = resolve(outDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}

// 构建后断言：确保未被根目录 index.html 覆盖，且不泄露插件专属文件。
for (const entry of ["index.html", "api.html"]) {
  const built = readFileSync(resolve(outDir, entry), "utf8");
  assert.ok(built.includes("<title>LocalOTP · 临时验证码</title>"), `${entry} 标题应为临时验证码页`);
  assert.ok(built.includes('data-surface="otp"'), `${entry} 应包含 data-surface="otp"`);
  assert.ok(!built.includes("LocalOTP · 账号管理"), `${entry} 不应包含账号管理页标题`);
  assert.ok(!built.includes("styles/page.css"), `${entry} 不应引用 styles/page.css`);
  for (const match of built.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(https?:|#|data:)/i.test(ref)) continue;
    assert.ok(existsSync(resolve(outDir, ref)), `${entry} 缺少构建后资源：${ref}`);
  }
}
for (const forbidden of ["popup.html", "manifest.json", "js/app.js", "js/store.js", "js/seed.js", "styles/page.css"]) {
  assert.ok(!existsSync(resolve(outDir, forbidden)), `Pages 产物不应包含插件文件：${forbidden}`);
}

console.log(`GitHub Pages 静态产物已生成：${outDir}（共复制 ${refs.size} 个引用资源 + index.html / api.html）`);
