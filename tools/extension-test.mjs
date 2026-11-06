/* 隔离的 Edge 配置验证真实 MV3 后台与 storage.sync，无浏览器账号登录。 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { CDP, evaluate, findBrowser, sleep, createBrowserProfile, cleanProfileOnExit } from "./cdp.mjs";
const profile = createBrowserProfile("extension-");
const port = 15000+Math.floor(Math.random()*20000);
const child = spawn(findBrowser(), ["--headless=new", "--edge-skip-compat-layer-relaunch", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${process.cwd()}`, "about:blank"],
  { stdio: "ignore", windowsHide: true });
cleanProfileOnExit(child, profile);
let cdp, worker;
let count = 0;
function check(name, value) { assert.ok(value, name); count++; console.log("✓ " + name); }
async function targets() { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
try {
  let all;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try { all = await targets(); if (all.some((x) => x.type === "service_worker")) break; } catch (_) {}
  }
  const sw = all?.find((x) => x.type === "service_worker" && x.url.endsWith("/js/background.js"));
  assert.ok(sw, "Edge 未加载测试扩展的 Service Worker");
  worker = await CDP.connect(sw.webSocketDebuggerUrl);
  const page = all.find((x) => x.type === "page");
  cdp = await CDP.connect(page.webSocketDebuggerUrl);
  const base = new URL("/", sw.url).href.replace(/\/$/, "");
  await cdp.send("Page.navigate", { url: base + "/index.html" });
  await sleep(650);
  check("真实扩展可使用同步 API", await evaluate(cdp, "OTP.store.sync.available()"));
  check("后台脚本成功初始化", await evaluate(worker, "OTP.store.state.ready"));
  const id = await evaluate(cdp, `(() => { const a=OTP.store.createAccount({email:'extension-test@example.com',password:'demo',secret:'JBSWY3DPEHPK3PXP'}); return a.id; })()`);
  const enabled = await evaluate(cdp, "OTP.store.sync.enable()");
  check("页面请求由后台完成同步", enabled.ok);
  check("真实 storage.sync 收到账号", await evaluate(worker, `(async()=>!!(await chrome.storage.sync.get('acc:${id}'))['acc:${id}'])()`));
  check("同步状态记录可见", await evaluate(cdp, "OTP.store.sync.info().lastSyncAt > 0"));
  // 关闭扩展页面，直接模拟远端同步存储的到达事件，验证后台继续合并。
  await cdp.send("Page.navigate", { url: "about:blank" });
  await evaluate(worker, `(async()=> { const key='acc:${id}'; const all=await chrome.storage.sync.get(key); all[key].note='远端更新'; all[key].updatedAt=Date.now()+1000; await chrome.storage.sync.set(all); })()`);
  let received = false;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    received = await evaluate(worker, `OTP.store.byId('${id}')?.note === '远端更新'`);
    if (received) break;
  }
  check("无打开页面时后台仍能接收变更", received);
  check("持久重试 alarm 已创建", await evaluate(worker, `(async()=>!!(await chrome.alarms.get('localotp:sync')))()`));
  await cdp.send("Page.navigate", { url: base + "/popup.html" }); await sleep(650);
  check("重开弹窗读到后台合并结果", await evaluate(cdp, `OTP.store.byId('${id}')?.note === '远端更新'`));
  await evaluate(cdp, "OTP.store.sync.disable()"); await sleep(100);
  check("关闭同步后取消后台 alarm", await evaluate(worker, `(async()=>!(await chrome.alarms.get('localotp:sync')))()`));
  console.log(`真实扩展测试 ${count} 项通过；未验证登录账号后的跨设备云端传输`);
} finally { cdp?.close(); worker?.close(); child.kill(); }
