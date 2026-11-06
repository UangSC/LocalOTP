#!/usr/bin/env node
/* ==========================================================================
   LocalOTP · 本地静态服务
   --------------------------------------------------------------------------
   用来在浏览器里直接验收两个页面，零依赖。

     node tools/serve.mjs            # http://127.0.0.1:8787
     node tools/serve.mjs 9000       # 换端口
     PORT=9000 node tools/serve.mjs

   http://localhost 属于安全上下文，剪贴板 API 可用；
   chrome.storage 不存在时会自动退回 localStorage —— 想验收真实扩展行为，
   请按 README 用「加载解压缩的扩展」。
   ========================================================================== */

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  const started = Date.now();
  let pathname = "/";
  try {
    pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch (err) {
    res.writeHead(400).end("bad request");
    return;
  }

  if (pathname === "/") pathname = "/popup.html";

  const target = normalize(join(ROOT, pathname));
  const inside = target === ROOT || target.startsWith(ROOT + sep);

  if (!inside || !existsSync(target)) {
    console.log(`404 ${pathname}`);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 not found");
    return;
  }

  let file = target;
  if (statSync(file).isDirectory()) {
    file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404).end("404");
      return;
    }
  }

  try {
    const body = readFileSync(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    console.log(`200 ${pathname}  ${Date.now() - started}ms`);
  } catch (err) {
    console.log(`500 ${pathname} ${err.message}`);
    res.writeHead(500).end("500");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`LocalOTP 预览服务已启动`);
  console.log(`  弹窗形态：http://${HOST}:${PORT}/popup.html`);
  console.log(`  管理页面：http://${HOST}:${PORT}/index.html`);
  console.log(`  根目录  ：${ROOT}`);
  console.log(`  Ctrl+C 退出`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用，换一个：node tools/serve.mjs 8788`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
