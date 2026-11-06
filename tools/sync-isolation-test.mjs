/* 两个真实 Edge 配置、同一扩展 ID、独立同步缓存。
 * 显式禁用云传输，复现 A 写入成功而 B 仍为空；不把本机 API 测试当作云同步验收。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { CDP, evaluate, findBrowser, sleep, createBrowserProfile, cleanProfileOnExit } from "./cdp.mjs";

let count = 0;
const check = (name, value) => { assert.ok(value, name); count++; console.log("✓ " + name); };
const sessions = [];
async function launch(port) {
  const profile = createBrowserProfile("sync-isolation-");
  const child = spawn(findBrowser(), ["--headless=new", "--disable-sync", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${process.cwd()}`, "about:blank"],
  { stdio: "ignore", windowsHide: true });
  cleanProfileOnExit(child, profile);
  const session = { child, worker: null, page: null };
  sessions.push(session);
  for (let attempt = 0; attempt < 100; attempt++) {
    let targets;
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch (_) {}
    const worker = targets?.find(target => target.type === "service_worker" && target.url.endsWith("/js/background.js"));
    if (worker) {
      session.worker = await CDP.connect(worker.webSocketDebuggerUrl);
      session.page = await CDP.connect(targets.find(target => target.type === "page").webSocketDebuggerUrl);
      await session.page.send("Page.navigate", { url: new URL("/index.html", worker.url).href });
      for (let wait = 0; wait < 100; wait++) {
        try { if (await evaluate(session.page, "OTP.store.state.ready")) return session; } catch (_) {}
        await sleep(50);
      }
      throw new Error("扩展页面未完成初始化");
    }
    await sleep(100);
  }
  throw new Error("隔离 Edge 未加载扩展");
}

try {
  const launched = await Promise.allSettled([launch(9446), launch(9447)]);
  for (const result of launched) if (result.status === "rejected") throw result.reason;
  const [a, b] = launched.map(result => result.value);
  const idA = await evaluate(a.worker, "chrome.runtime.id");
  const idB = await evaluate(b.worker, "chrome.runtime.id");
  check("两个真实配置使用同一个固定 ID", idA === idB && idA === "mjpifhendkddjgmoheglnfciammaipji");
  await evaluate(a.page, `(() => {
    for (let i=0;i<5;i++) OTP.store.createAccount({email:'isolated-'+i+'@example.com',password:'test-only',secret:'JBSWY3DPEHPK3PXP'});
  })()`);
  const sent = await evaluate(a.page, "OTP.store.sync.enable()");
  check("A 写入 5 条的回执只确认本机缓存", sent.ok && sent.pushed === 5 && sent.scope === "browser-cache" && sent.cloudStatus === "unverified");
  const empty = await evaluate(b.page, "OTP.store.sync.enable()");
  check("B 调用成功但缓存和本机账号均为零", empty.ok && empty.remoteAccounts === 0 && empty.localAccounts === 0);
  const feedback = await evaluate(a.page, `OTP.syncFeedback(${JSON.stringify(sent)})`);
  check("A 的反馈明确云端传输未经确认", feedback.kind === "warn" && feedback.text.includes("写入缓存 5 条") && feedback.text.includes("未确认云端传输"));
  const emptyFeedback = await evaluate(b.page, `OTP.syncFeedback(${JSON.stringify(empty)})`);
  check("B 的反馈指向传输诊断而不是认定旧 ID 有错", emptyFeedback.text.includes("Extension Settings") && !emptyFeedback.text.includes("旧版 ID"));
  const before = await evaluate(a.worker, "chrome.storage.sync.get(null).then(JSON.stringify)");
  const report = await evaluate(a.page, "OTP.store.sync.inspect()");
  check("诊断显示运行时 ID、版本和准确缓存数量", report.extensionId === idA && report.extensionVersion && report.localAccounts === 5 && report.cachedAccounts === 5);
  check("诊断没有账号内容或密码密钥", !/example\.com|test-only|JBSWY3DPEHPK3PXP/.test(JSON.stringify(report)));
  check("只读诊断没有修改同步缓存", before === await evaluate(a.worker, "chrome.storage.sync.get(null).then(JSON.stringify)"));
  const again = await evaluate(a.page, "OTP.store.sync.now()");
  check("真实存储往返后再次合并不会重复写入或虚报拉取", again.remoteAccounts === 5 && again.pushed === 0 && again.pulled === 0 && again.cloudStatus === "unverified");
  check("B 的空合并不会清除 A 的五条账号", (await evaluate(a.page, "OTP.store.sync.inspect()")).cachedAccounts === 5);
  const state = await evaluate(a.page, "OTP.store.sync.info()");
  check("状态不会把上次成功时间当作云端确认", state.lastSyncAt > 0 && state.cloudStatus === "unverified");
  console.log(`同步隔离测试 ${count} 项通过；云传输显式关闭，未进行双设备云端验收`);
} finally {
  for (const session of sessions) { session.page?.close(); session.worker?.close(); session.child.kill(); }
}
