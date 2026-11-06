/* 真实 Edge：管理页授权接续、复用、跨窗口聚焦与已锁定页面边界。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { CDP, evaluate, findBrowser, sleep, createBrowserProfile, cleanProfileOnExit } from "./cdp.mjs";

const profile = createBrowserProfile("management-"), port = 9448;
const child = spawn(findBrowser(), ["--headless=new", "--disable-sync", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${process.cwd()}`, "about:blank"],
{ stdio: "ignore", windowsHide: true });
cleanProfileOnExit(child, profile);
const connections = [];
const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const connect = async url => { const cdp = await CDP.connect(url); connections.push(cdp); return cdp; };
let count = 0, worker, popup, base;
const check = (name, value) => { assert.ok(value, name); count++; console.log("✓ " + name); };
async function until(cdp, expression) {
  for (let i = 0; i < 140; i++) { try { if (await evaluate(cdp, expression)) return; } catch (_) {} await sleep(50); }
  throw new Error("等待页面状态超时：" + expression);
}
async function unlock(cdp) {
  await until(cdp, '!!document.querySelector("#pw-lock") && !document.querySelector(".lock").inert');
  await evaluate(cdp, `(()=>{document.querySelector('#pw-lock').value='management-test';document.querySelector('.lock-form').requestSubmit()})()`);
  await until(cdp, '!document.querySelector(".lock") && document.querySelector("#screen.is-in")');
}
async function manager() {
  for (let i = 0; i < 100; i++) {
    const target = (await targets()).find(target => target.type === "page" && target.url.startsWith(base + "index.html"));
    if (target) { const cdp = await connect(target.webSocketDebuggerUrl); await until(cdp, "!!OTP.store.state.ready"); return cdp; }
    await sleep(50);
  }
  throw new Error("没有找到管理页");
}
const managementTabs = () => evaluate(worker, `chrome.tabs.query({}).then(tabs=>tabs.filter(t=>(t.pendingUrl||t.url||'').startsWith(${JSON.stringify(base)}+'index.html')).map(t=>({id:t.id,windowId:t.windowId,active:t.active})))`);

try {
  let sw, list;
  for (let i = 0; i < 100; i++) { try { list = await targets(); sw = list.find(target => target.url.endsWith("/js/background.js")); if (sw) break; } catch (_) {} await sleep(100); }
  assert.ok(sw, "扩展后台未启动"); base = new URL("/", sw.url).href;
  worker = await connect(sw.webSocketDebuggerUrl); popup = await connect(list.find(target => target.type === "page").webSocketDebuggerUrl);
  await popup.send("Page.navigate", { url: base + "popup.html" }); await until(popup, "!!OTP.store.state.ready");
  await evaluate(popup, "OTP.store.setPassword('management-test')");
  await popup.send("Page.reload"); await unlock(popup);
  check("免密关闭且未增加 tabs 权限", await evaluate(popup, "OTP.store.settings().rememberMinutes===0 && !chrome.runtime.getManifest().permissions.includes('tabs')"));
  const first = await evaluate(popup, "OTP.app.openFullPage()");
  check("已解锁弹窗可创建管理页", first?.ok && !first.reused);
  let page = await manager(); await until(page, '!document.querySelector(".lock") && document.querySelector("#screen.is-in")');
  check("新管理页已解锁，URL 中票据已清除", await evaluate(page, "!location.hash && !document.querySelector('#screen').inert"));
  check("新页面没有开启全局免密租约", await evaluate(worker, "chrome.storage.session.get('localotp:access:v1').then(v=>!v['localotp:access:v1'].lease)"));
  await evaluate(page, "globalThis.managementMarker='preserved';document.querySelector('#page-search').value='保留搜索'");
  const again = await evaluate(popup, "OTP.app.openFullPage()");
  check("再次打开复用同一标签页", again?.ok && again.reused && again.tabId === first.tabId && (await managementTabs()).length === 1);
  check("复用时不刷新文档且保留搜索与解锁状态", await evaluate(page, "globalThis.managementMarker==='preserved' && document.querySelector('#page-search').value==='保留搜索' && !document.querySelector('.lock')"));
  await evaluate(worker, `chrome.windows.create({tabId:${first.tabId},focused:false})`);
  const focused = await evaluate(popup, "OTP.app.openFullPage()");
  check("其他窗口的管理页也能复用并聚焦", focused?.tabId === first.tabId && await evaluate(worker, `chrome.tabs.get(${first.tabId}).then(t=>chrome.windows.get(t.windowId)).then(w=>w.focused)`));
  const denied = await evaluate(popup, "chrome.runtime.sendMessage({type:'localotp:access',action:'page',proof:'forged'})");
  check("伪造授权不能打开或复用管理页", !denied.ok && denied.code === "AUTH_REQUIRED");
  await evaluate(page, "OTP.app.lock()"); await until(popup, '!!document.querySelector(".lock")');
  await unlock(popup);
  const locked = await evaluate(popup, "OTP.app.openFullPage()");
  check("已锁定的既有管理页只激活，仍需密码", locked?.reused && await evaluate(page, "!!document.querySelector('.lock') && document.querySelector('#screen').inert"));
  await evaluate(worker, `chrome.tabs.remove(${first.tabId})`);
  const simultaneous = await evaluate(popup, "Promise.all([OTP.app.openFullPage(),OTP.app.openFullPage()])");
  check("关闭后并发打开只创建一个新标签", simultaneous.every(result => result.ok) && simultaneous[0].tabId === simultaneous[1].tabId && (await managementTabs()).length === 1);
  page = await manager(); await until(page, '!document.querySelector(".lock") && document.querySelector("#screen.is-in")');
  const direct = await evaluate(worker, `chrome.tabs.create({url:${JSON.stringify(base + "index.html")},active:false})`);
  let directTarget;
  for (let i = 0; i < 100; i++) {
    const pages = (await targets()).filter(t => t.type === "page" && t.url.startsWith(base + "index.html"));
    for (const target of pages) {
      const candidate = await connect(target.webSocketDebuggerUrl);
      try { if (await evaluate(candidate, `chrome.tabs.getCurrent().then(t=>t.id===${direct.id})`)) { directTarget = candidate; break; } } catch (_) {}
    }
    if (directTarget) break; await sleep(50);
  }
  assert.ok(directTarget, "未找到直接打开的管理页"); await until(directTarget, '!!document.querySelector(".lock")');
  check("直接打开无票据新页面不会继承其他页面授权", await evaluate(directTarget, "document.querySelector('#screen').inert"));
  console.log(`管理页测试 ${count} 项通过`);
} finally { for (const connection of connections) connection.close(); child.kill(); }
