/* ==========================================================================
   LocalOTP · tools/cdp
   截图与端到端自检共用的小工具：静态服务、无头 Edge、CDP 客户端。
   零依赖（Node 内置 http / WebSocket）。
   ========================================================================== */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { extname, join, normalize, resolve, dirname } from "node:path";

const profileRoot = resolve(process.env.LOCALOTP_TEST_DIR || join(process.cwd(), "..", "Merge2FA-test-cache"));
const ownedProfiles = new Set();
export function createBrowserProfile(prefix = "run-") {
  mkdirSync(profileRoot, { recursive: true });
  const profile = mkdtempSync(join(profileRoot, prefix));
  ownedProfiles.add(profile);
  return profile;
}
export function cleanProfileOnExit(child, profile) {
  child.once("exit", () => setTimeout(() => {
    const target = resolve(profile);
    // 仅删除本进程创建、且直接位于测试缓存目录下的隔离配置。
    if (!ownedProfiles.has(profile) || dirname(target) !== profileRoot) return;
    try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); }
    catch (_) { console.warn("测试配置暂被浏览器占用，保留在：" + target); }
    ownedProfiles.delete(profile);
  }, 350));
}

export const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function findBrowser() {
  return EDGE_PATHS.find((path) => existsSync(path)) || null;
}

export function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let path = decodeURIComponent((req.url || "/").split("?")[0]);
      if (path === "/") path = "/popup.html";
      const file = normalize(join(root, path));
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404).end("not found");
        return;
      }
      try {
        const body = readFileSync(file);
        res.writeHead(200, {
          "Content-Type": MIME[extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500).end(String(err));
      }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

export class CDP {
  constructor(socket, onEvent) {
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.onEvent = onEvent || null;

    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (this.onEvent) this.onEvent(msg.method, msg.params);
      const handlers = this.listeners.get(msg.method);
      if (handlers) handlers.forEach((fn) => fn(msg.params));
    });
  }

  static connect(url, onEvent) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new CDP(socket, onEvent)));
      socket.addEventListener("error", () => reject(new Error("websocket 连接失败")));
    });
  }

  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("timeout: " + method));
        }
      }, 20000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  close() {
    try {
      this.socket.close();
    } catch (err) {
      /* noop */
    }
  }
}

/** 启动无头浏览器，返回 { process, port } */
export async function launchBrowser(binary, port, { gpu = false, hideScrollbars = true } = {}) {
  port = 15000 + Math.floor(Math.random() * 20000);
  const profile = createBrowserProfile("cdp-");
  const child = spawn(
    binary,
    [
      "--headless=new", "--edge-skip-compat-layer-relaunch",
      ...(gpu ? [] : ["--disable-gpu"]),
      "--no-first-run",
      "--no-default-browser-check",
      ...(hideScrollbars ? ["--hide-scrollbars"] : []),
      "--force-device-scale-factor=2",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true }
  );
  cleanProfileOnExit(child, profile);

  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return { process: child, target: page };
    } catch (err) {
      /* 还没起来 */
    }
  }
  child.kill();
  throw new Error("无法连接无头浏览器");
}

export async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const text =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "evaluate failed";
    throw new Error(text.split("\n")[0]);
  }
  return result.result ? result.result.value : null;
}

export async function setViewport(cdp, width, height, scale = 2) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  });
  // CDP 已接受尺寸不代表合成帧已经呈现；实际指针测试需等新布局提交。
  await evaluate(cdp, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
}

export async function goto(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await sleep(520);
}

/* 通过调试协议检查封闭 Shadow DOM，不为自动化把网页扫码界面开放给站点脚本。 */
export async function shadowCall(cdp, hostId, selector, functionDeclaration, args = []) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  function find(node) {
    const attrs = node.attributes || [];
    if (attrs.some((value, i) => i % 2 === 0 && value === 'id' && attrs[i + 1] === hostId)) return node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = find(child); if (found) return found; }
  }
  const host = find(root);
  if (!host?.shadowRoots?.[0]) throw new Error('未找到蒙版：' + hostId);
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: host.shadowRoots[0].nodeId, selector });
  if (!nodeId) throw new Error('蒙版中缺少控件：' + selector);
  const { object } = await cdp.send('DOM.resolveNode', { nodeId });
  try {
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration,
      arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  } finally { await cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {}); }
}
