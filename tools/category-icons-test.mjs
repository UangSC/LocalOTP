/* 平台分类图标：真实浏览器中的选择、编辑、持久化、主题与小窗边界。 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CDP, evaluate, findBrowser, goto, launchBrowser, setViewport, sleep, startServer } from "./cdp.mjs";

const ROOT = process.cwd(), PASSWORD = "category-icons-public-test";
const PLATFORM_KEYS = ["brand-google", "brand-chatgpt", "brand-github", "brand-microsoft", "brand-apple", "brand-youtube",
  "brand-discord", "brand-telegram", "brand-x", "brand-amazon", "brand-facebook", "brand-instagram"];
const { server, port } = await startServer(ROOT);
const { process: browser, target } = await launchBrowser(findBrowser(), undefined, { hideScrollbars: false });
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const errors = [], remoteRequests = [];
let count = 0;
async function check(name, expression) {
  assert.ok(await evaluate(cdp, expression), name);
  console.log("✓ " + name); count++;
}
async function click(selector) {
  await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await sleep(70);
  const box = await evaluate(cdp, `(()=>{const node=document.querySelector(${JSON.stringify(selector)}),r=node.getBoundingClientRect();
    const point={x:r.left+r.width/2,y:r.top+r.height/2};
    if(!node.contains(document.elementFromPoint(point.x,point.y))) throw new Error('分类控件被遮挡'); return point})()`);
  for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 });
  await sleep(100);
}
async function unlock() {
  await evaluate(cdp, `document.querySelector('#pw-lock').value=${JSON.stringify(PASSWORD)}; document.querySelector('.lock-form').requestSubmit(); void 0`);
  for (let i = 0; i < 100; i++) {
    if (await evaluate(cdp, "!document.querySelector('.lock')")) return;
    await sleep(40);
  }
  throw new Error("测试页面未解锁");
}
async function manager() {
  await evaluate(cdp, "OTP.sheets.openCategoryManager()"); await sleep(340);
}
async function addEditor() {
  await manager(); await click(".sheet-foot .btn-primary");
}
async function screenshot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(ROOT, "artifacts", name), Buffer.from(data, "base64"));
}

try {
  mkdirSync(resolve(ROOT, "artifacts"), { recursive: true });
  await cdp.send("Runtime.enable"); await cdp.send("Network.enable"); await cdp.send("Page.enable");
  cdp.on("Runtime.exceptionThrown", event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  cdp.on("Network.requestWillBeSent", event => {
    const url = event.request.url;
    if (/^https?:/.test(url) && new URL(url).hostname !== "127.0.0.1") remoteRequests.push(url);
  });
  await setViewport(cdp, 1100, 800, 1);
  const base = `http://127.0.0.1:${port}`;
  await goto(cdp, base + "/index.html");
  await evaluate(cdp, `OTP.store.setPassword(${JSON.stringify(PASSWORD)})`);
  await goto(cdp, base + "/index.html"); await unlock();
  await check("保留12个通用图标并新增12个平台", `OTP.store.CATEGORY_ICONS.length===24 && ${JSON.stringify(PLATFORM_KEYS)}.every(key=>OTP.store.CATEGORY_ICONS.includes(key))`);
  await check("X 平台与关闭图标互不混淆", "OTP.icon('brand-x')!==OTP.icon('x') && OTP.icon('x').includes('M6.2 6.2')");
  await addEditor();
  await check("两组图标完整且默认只有文件夹选中", "document.querySelectorAll('.icon-grid').length===2 && document.querySelectorAll('.icon-option').length===24 && document.querySelectorAll('.icon-option[aria-pressed=true]').length===1 && document.querySelector('.icon-option[aria-pressed=true]').dataset.icon==='folder'");
  await check("平台按钮名称与悬停提示齐全", "[...document.querySelectorAll('.icon-option[data-icon^=brand-]')].every(button=>button.getAttribute('aria-label')===OTP.brandIconLabels[button.dataset.icon] && button.dataset.tip===button.title)");
  await click("[data-icon=brand-google]");
  await check("跨组选择保持唯一状态", "document.querySelectorAll('.icon-option[aria-pressed=true]').length===1 && document.querySelector('.icon-option[aria-pressed=true]').dataset.icon==='brand-google'");
  await evaluate(cdp, "document.querySelector('.sheet-body input').value='平台公开测试'");
  await click(".sheet-foot .btn-primary");
  await check("创建分类保存 Google 图标", "OTP.store.categories().find(category=>category.name==='平台公开测试')?.icon==='brand-google'");
  await evaluate(cdp, "[...document.querySelectorAll('.cat-row-item')].find(row=>row.querySelector('.cat-label').textContent==='平台公开测试').querySelector('[aria-label=编辑分类]').click()");
  await check("编辑回填原平台图标", "document.querySelector('.icon-option[aria-pressed=true]').dataset.icon==='brand-google'");
  await click("[data-icon=brand-chatgpt]"); await click(".sheet-foot .btn-primary");
  await check("编辑保存 ChatGPT 图标", "OTP.store.categories().find(category=>category.name==='平台公开测试')?.icon==='brand-chatgpt'");
  await click(".sheet-foot .btn-ghost");
  await check("分类返回设置页不报错", "document.querySelector('#sheet-title').textContent==='管理' && document.querySelector('#sheet-sub').textContent==='外观、门禁、同步与备份'");
  await evaluate(cdp, "OTP.ui.closeSheet(true)"); await sleep(430);
  await evaluate(cdp, `(()=>{for(const [index,key] of ${JSON.stringify(PLATFORM_KEYS)}.entries()) OTP.store.saveCategory({name:'平台'+index,icon:key}); OTP.app.renderAll({stagger:false})})()`);
  await check("每个平台均通过存储白名单并完整导出", `(()=>{const cats=OTP.store.exportPayload().categories;return ${JSON.stringify(PLATFORM_KEYS)}.every((key,index)=>cats.find(cat=>cat.name==='平台'+index)?.icon===key)})()`);
  await check("管理页导航呈现品牌矢量", "(()=>{const node=[...document.querySelectorAll('.nav-item')].find(node=>node.querySelector('.nav-label')?.textContent==='平台公开测试');return node?.querySelector('svg path')?.getTotalLength()>10})()");
  await evaluate(cdp, "OTP.store.persist()");
  await goto(cdp, base + "/index.html"); await unlock();
  await check("重新加载保留平台分类键", `(()=>{const cats=OTP.store.categories();return ${JSON.stringify(PLATFORM_KEYS)}.every((key,index)=>cats.find(cat=>cat.name==='平台'+index)?.icon===key)})()`);
  await addEditor();
  for (const theme of ["light", "dark"]) {
    await evaluate(cdp, `OTP.store.patchSettings({theme:${JSON.stringify(theme)}}); OTP.app.applyTheme(false)`); await sleep(80);
    await check(theme + "主题下ChatGPT/GitHub实心图标跟随文字色", "['brand-chatgpt','brand-github'].every(key=>{const svg=document.querySelector(`[data-icon=${key}] svg`),path=svg.querySelector('path');return getComputedStyle(path).fill===getComputedStyle(svg).color && getComputedStyle(path).stroke==='none' && path.getTotalLength()>10})");
    await check(theme + "主题下Google/微软四种品牌颜色可见", "['brand-google','brand-microsoft'].every(key=>{const paths=[...document.querySelectorAll(`[data-icon=${key}] path`)];return paths.length===4 && new Set(paths.map(path=>getComputedStyle(path).fill)).size===4})");
    await check(theme + "主题下全部平台矢量有可见边界", "[...document.querySelectorAll('.icon-option[data-icon^=brand-] svg')].every(svg=>{const box=svg.querySelector('g').getBBox();return box.width>8 && box.height>8 && box.width<=24.05 && box.height<=24.05})");
    await screenshot("category-icons-" + theme + ".png");
    if (theme === "light") {
      const clip = await evaluate(cdp, "(()=>{const grids=document.querySelectorAll('.icon-grid'),top=grids[0].previousElementSibling.getBoundingClientRect(),bottom=grids[1].getBoundingClientRect();return {x:bottom.left-4,y:top.top-4,width:bottom.width+8,height:bottom.bottom-top.top+8,scale:2}})()");
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip });
      writeFileSync(resolve(ROOT, "artifacts/category-platform-icons.png"), Buffer.from(data, "base64"));
    }
  }
  await evaluate(cdp, "OTP.ui.closeSheet(true); OTP.store.patchSettings({theme:'light'})"); await sleep(400);
  await setViewport(cdp, 320, 380, 1.25);
  await goto(cdp, base + "/popup.html"); await unlock();
  await setViewport(cdp, 320, 380, 1.25);
  await addEditor();
  await check("320px小窗两组网格不横向越界", "[...document.querySelectorAll('.icon-grid')].every(grid=>{const r=grid.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && grid.scrollWidth<=grid.clientWidth+1})");
  await check("小窗内容由抽屉内部滚动", "(()=>{const body=OTP.ui.refs.sheetBody;return body.scrollHeight>body.clientHeight && ['auto','scroll'].includes(getComputedStyle(body).overflowY)})()");
  await click("[data-icon=brand-instagram]");
  await check("滚动后能选择末尾平台图标", "document.querySelector('.icon-option[aria-pressed=true]').dataset.icon==='brand-instagram' && OTP.ui.refs.sheetBody.scrollTop>0");
  await screenshot("category-icons-popup-320.png");
  assert.deepEqual(errors, [], "页面出现异常");
  assert.deepEqual(remoteRequests, [], "图标触发了在线依赖");
  console.log(`分类平台图标 ${count} 项检查通过，无页面异常或在线图标请求`);
} finally {
  cdp.close(); browser.kill(); server.close();
}
