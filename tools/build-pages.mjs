/* 生成 GitHub Pages 静态发布目录：仅打包 api.html 及其直接引用的样式、脚本和图标。 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArgIndex = process.argv.indexOf("--out");
const outDir = resolve(root, outArgIndex >= 0 && process.argv[outArgIndex + 1] ? process.argv[outArgIndex + 1] : "_site");

const apiHtmlPath = resolve(root, "api.html");
const apiHtml = readFileSync(apiHtmlPath, "utf8");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 根路径直接打开即呈现 API 临时验证码页面，同时保留 api.html 路径兼容。
writeFileSync(resolve(outDir, "index.html"), apiHtml, "utf8");
writeFileSync(resolve(outDir, "api.html"), apiHtml, "utf8");
writeFileSync(resolve(outDir, ".nojekyll"), "", "utf8");

const refs = new Set();
for (const match of apiHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = match[1];
  if (/^(https?:|#|data:)/i.test(ref)) continue;
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

console.log(`GitHub Pages 静态产物已生成：${outDir}（共复制 ${refs.size} 个引用资源 + index.html / api.html）`);
