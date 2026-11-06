/* 实际指针命中与快速交互回归，截图只包含公开演示数据。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { CDP, evaluate, findBrowser, goto, launchBrowser, setViewport, sleep, startServer } from "./cdp.mjs";
const { server, port } = await startServer(process.cwd());
const { process: browser, target } = await launchBrowser(findBrowser(), 9357);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const errors = [];
cdp.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails.text));
let checks = 0;
async function check(name, expression) {
  assert.ok(await evaluate(cdp, expression), name);
  checks++; console.log("✓ " + name);
}
async function click(selector) {
  const point = await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('找不到控件：' + ${JSON.stringify(selector)});
    const box = node.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x,y);
    if (!node.contains(hit)) throw new Error('控件被遮挡：' + ${JSON.stringify(selector)} + ' by ' + hit?.className);
    return { x, y };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}
async function unlock() {
  for (let i=0;i<40;i++) {
    if (await evaluate(cdp, `document.querySelector('.lock') && !document.querySelector('.lock').inert`)) break;
    await sleep(40);
  }
  await evaluate(cdp, `document.querySelector('#pw-lock').value='test-password'; document.querySelector('.lock-form').requestSubmit(); void 0`);
  for (let i = 0; i < 60; i++) {
    if (await evaluate(cdp, `!document.querySelector('.lock') && !document.querySelector('#screen').inert`)) return;
    await sleep(50);
  }
  throw new Error("解锁未完成：" + await evaluate(cdp, `document.querySelector('.lock-err')?.textContent`));
}
async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve("artifacts", name), Buffer.from(data, "base64"));
}
try {
  mkdirSync(resolve("artifacts"), { recursive: true });
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await setViewport(cdp, 1440, 900, 1);
  const url = `http://127.0.0.1:${port}/index.html`;
  await goto(cdp, url);
  await click(".lock-foot-links button"); await sleep(300);
  await check("锁屏快捷键对话框显示在锁屏上方", `document.querySelector('.dialog').classList.contains('is-open')`);
  await click(".dialog .btn-primary"); await sleep(250);
  await check("锁屏对话框确认按钮可点击", `!document.querySelector('.dialog').classList.contains('is-open')`);
  await evaluate(cdp, `OTP.store.setPassword('test-password')`);
  await goto(cdp, url + "?unlock"); await unlock();
  await check("解锁完成后两个内容区都可操作", `!document.querySelector('#screen').inert && !document.querySelector('.sidebar').inert`);
  await click('.sw-ico[data-id="grid"]');
  await check("点击卡片选项立即改变视图", `document.querySelector('#list').dataset.view === 'grid'`);
  await sleep(220);
  await click('.sw-ico[data-id="grid"]');
  await check("再次点击已选卡片不会反向切换", `document.querySelector('#list').dataset.view === 'grid'`);
  for (const view of ["list", "grid", "list", "grid", "list"]) await click(`.sw-ico[data-id="${view}"]`);
  await sleep(300);
  await check("快速连点以最后一次选择为准", `OTP.store.settings().view === 'list' && document.querySelector('#list').dataset.view === 'list' && document.querySelector('.sw-switch').dataset.value === 'list'`);
  await click("#page-refresh-btn"); await sleep(120);
  await check("实际点击刷新有成功回执", `document.querySelector('.toasts').textContent.includes('验证码已刷新')`);
  await check("刷新后忙碌状态释放", `!document.querySelector('#page-refresh-btn').hasAttribute('aria-busy')`);
  await evaluate(cdp, `window.savedRow = document.querySelector('.item'); OTP.app.renderAll({stagger:false})`);
  await check("未变更的账号节点被复用", `window.savedRow === document.querySelector('.item')`);
  await click('.sw-ico[data-id="grid"]'); await sleep(900); await shot("23-grid-refined.png");
  await click('.card-tools button[aria-label="更多操作"]');
  await check("卡片更多操作按钮可点击", `document.querySelector('.menu').classList.contains('is-open')`);
  await evaluate(cdp, `OTP.ui.closeMenu()`);
  await click("#side-lock");
  await check("锁屏开始即禁止内容区交互", `document.querySelector('#screen').inert && document.querySelector('.sidebar').inert`);
  await sleep(850); await shot("24-lock-refined.png");
  await check("锁屏清除复制通知", `document.querySelector(".toasts").childElementCount === 0`);
  await check("锁屏结束无遗留覆盖层", `!document.querySelector('.flip-panel') && !document.querySelector('.lock').inert`);
  await unlock();
  for (let i = 0; i < 4; i++) {
    await click("#side-lock"); await sleep(540); await unlock();
  }
  await check("连续锁定解锁后无隐藏面板挡住按钮", `!document.querySelector('.lock') && !document.querySelector('.flip-panel') && !document.querySelector('#screen').inert`);
  await click('.sw-ico[data-id="list"]'); await sleep(200); await click("#page-refresh-btn");
  await evaluate(cdp, `OTP.sheets.openCategoryManager()`); await sleep(450);
  await click('.sheet-foot .btn-primary'); await sleep(100);
  await check("分类新增入口打开编辑器", `document.querySelector('.sheet-title').textContent === '新增分类'`);
  await click('.sheet-foot .btn-ghost'); await sleep(100);
  await check("分类取消返回管理列表", `document.querySelector('.sheet-title').textContent === '管理分类'`);
  await click('.sheet-foot .btn-primary'); await sleep(100);
  await evaluate(cdp, `document.querySelector('.sheet-body input').value='回归分类'`);
  await click('.sheet-foot .btn-primary'); await sleep(120);
  await check("保存分类返回列表并显示结果", `document.querySelector('.sheet-title').textContent === '管理分类' && document.querySelector('.cat-manager').textContent.includes('回归分类')`);
  await evaluate(cdp, `OTP.ui.closeSheet()`); await sleep(450);
  await click("#side-settings"); await sleep(450);
  await check("设置面板可打开", `document.querySelector('.sheet').classList.contains('is-open')`);
  await check("本地预览如实标记同步不可用", `document.querySelector('[aria-label="浏览器同步"]').disabled`);
  await evaluate(cdp, `OTP.ui.closeSheet(); OTP.store.patchSettings({theme:'dark'}); OTP.app.applyTheme(false);`);
  await sleep(450); await shot("25-dark-refined.png");
  await click("#side-lock"); await sleep(550); await unlock();
  await check("深色锁屏往返仍保持主题", `document.documentElement.dataset.theme === 'dark' && !document.querySelector('.flip-panel')`);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await click("#side-lock"); await sleep(70); await unlock();
  await check("减少动态效果模式无残留动画", `!document.querySelector('.flip-panel') && !document.querySelector('.lock')`);
  await setViewport(cdp, 480, 800, 1);
  await click("#compact-settings"); await sleep(250);
  await check("窄屏设置入口可点击", `document.querySelector('.sheet').classList.contains('is-open')`);
  await evaluate(cdp, `OTP.ui.closeSheet()`); await sleep(450);
  await click("#compact-lock"); await sleep(80); await unlock();
  await check("窄屏锁屏按钮可用", `!document.querySelector('.lock')`);
  await setViewport(cdp, 1440, 900, 1);
  await evaluate(cdp, `OTP.store.patchSettings({theme:'light'}); OTP.app.applyTheme(false); OTP.store.replaceAccounts(Array.from({length:500},(_,i)=>({id:'bulk-'+i,email:'test'+i+'@example.com',password:'demo',secret:'JBSWY3DPEHPK3PXP',issuer:'测试服务',createdAt:1,updatedAt:1}))); OTP.app.renderAll({stagger:false});`);
  await check("500 条列表完整渲染", `document.querySelectorAll('#list .item').length===500`);
  const reuse = await evaluate(cdp, `(() => { const before=[...document.querySelectorAll('#list .item')]; const start=performance.now(); OTP.app.renderAll({stagger:false}); return {ms:Math.round(performance.now()-start),same:before.every((n,i)=>n===document.querySelectorAll('#list .item')[i])}; })()`);
  assert.ok(reuse.same); checks++; console.log('✓ 500 条重复渲染复用全部节点，耗时 ' + reuse.ms + 'ms');
  await click('.sw-ico[data-id="grid"]');
  await check("500 条卡片视图可切换", `document.querySelectorAll('#list .card').length===500`);
  assert.deepEqual(errors, []);
  console.log(`交互回归 ${checks} 项通过，无页面异常`);
} finally { cdp.close(); browser.kill(); server.close(); }
