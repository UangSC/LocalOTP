/* 自定义选择器验收：真实鼠标／键盘，编辑写入、两种主题和弹窗边界。 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CDP, evaluate, findBrowser, goto, launchBrowser, setViewport, sleep, startServer } from "./cdp.mjs";
const {server,port}=await startServer(process.cwd());
const {process:browser,target}=await launchBrowser(findBrowser(),9378);
const cdp=await CDP.connect(target.webSocketDebuggerUrl);
const errors=[];
let count=0;
async function check(name,expr) {assert.ok(await evaluate(cdp,expr),name); count++; console.log("✓ "+name);}
async function click(selector) {
  const box=await evaluate(cdp,`(()=>{const n=document.querySelector(${JSON.stringify(selector)}); const r=n.getBoundingClientRect(); const p={x:r.left+r.width/2,y:r.top+r.height/2}; if(!n.contains(document.elementFromPoint(p.x,p.y))) throw new Error('按钮被遮挡'); return p})()`);
  for(const type of ["mousePressed","mouseReleased"]) await cdp.send("Input.dispatchMouseEvent",{type,...box,button:"left",clickCount:1});
}
async function key(value) {
  await cdp.send("Input.dispatchKeyEvent",{type:"keyDown",key:value});
  await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key:value});
}
async function openEditor() {
  await evaluate(cdp,"OTP.sheets.openEditor(OTP.store.accounts()[0])"); await sleep(500);
  await evaluate(cdp,"document.querySelector('.select-trigger').scrollIntoView({block:'center',behavior:'instant'})"); await sleep(100);
}
async function screenshot(name) {
  const {data}=await cdp.send("Page.captureScreenshot",{format:"png"});
  writeFileSync(resolve("docs/shots",name),Buffer.from(data,"base64"));
}
try {
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown",e=>errors.push(e.exceptionDetails.text));
  await setViewport(cdp,1440,900,1);
  const base=`http://127.0.0.1:${port}`;
  await goto(cdp,base+"/index.html"); await evaluate(cdp,"OTP.store.setPassword('select-test')");
  await goto(cdp,base+"/index.html?test");
  await evaluate(cdp,"document.querySelector('#pw-lock').value='select-test'; document.querySelector('.lock-form').requestSubmit(); void 0");
  for(let i=0;i<70;i++){if(await evaluate(cdp,"!document.querySelector('.lock')"))break;await sleep(50);}
  await openEditor();
  await check("编辑器没有原生 select", "!document.querySelector('.sheet select')");
  await check("原分类正确回填", "document.querySelector('.select-trigger').value===OTP.store.accounts()[0].categoryId");
  await click(".select-trigger"); await sleep(230);
  await check("点击展开自定义列表", "document.querySelector('.select-trigger').getAttribute('aria-expanded')==='true' && !!document.querySelector('[role=listbox]')");
  await check("已选分类有唯一勾选项", "document.querySelectorAll('.select-option[aria-selected=true]').length===1");
  await check("键盘焦点保留在触发器", "document.activeElement.classList.contains('select-trigger')");
  await screenshot("26-select-light.png");
  await key("End");
  await check("End 定位最后一项", "document.querySelector('.select-option:last-child').classList.contains('is-active')");
  await key("Escape");
  await check("Esc 只关下拉不关编辑器", "!document.querySelector('.select-popup') && OTP.ui.isSheetOpen()");
  await key("ArrowDown"); await key("Home"); await key("ArrowDown");
  const wanted=await evaluate(cdp,"document.querySelector('.select-option.is-active').textContent");
  await key("Enter");
  await check("Enter 确认并关闭", "!document.querySelector('.select-popup') && document.querySelector('.select-trigger').value===OTP.store.categories()[0].id");
  await click(".sheet-foot .btn-primary"); await sleep(500);
  await check("选择的分类保存到账号", "OTP.store.accounts()[0].categoryId===OTP.store.categories()[0].id");
  await openEditor(); await click(".select-trigger"); await sleep(100);
  await click(".select-option:first-child");
  await check("鼠标选择未分类", "document.querySelector('.select-trigger').value==='' && !document.querySelector('.select-popup')");
  await click(".select-trigger"); await key("Tab");
  await check("Tab 正常离开并关闭菜单", "!document.querySelector('.select-popup') && !document.activeElement.classList.contains('select-trigger')");
  await click(".select-trigger"); await click("#f-email");
  await check("点击外部关闭菜单", "!document.querySelector('.select-popup')");
  await click(".select-trigger"); await evaluate(cdp,"OTP.ui.closeSheet()"); await sleep(460);
  await check("关闭抽屉清理菜单", "!document.querySelector('.select-popup')");
  await evaluate(cdp,"OTP.store.patchSettings({theme:'dark'}); OTP.app.applyTheme(false)");
  await openEditor(); await click(".select-trigger"); await sleep(230); await screenshot("27-select-dark.png");
  await check("深色菜单使用深色面层", "getComputedStyle(document.querySelector('.select-popup')).backgroundColor !== 'rgb(255, 255, 255)'");
  await evaluate(cdp,"OTP.ui.closeSheet(); OTP.store.patchSettings({theme:'light'})");
  await setViewport(cdp,402,600,1);
  await goto(cdp,base+"/popup.html");
  await evaluate(cdp,"document.querySelector('#pw-lock').value='select-test'; document.querySelector('.lock-form').requestSubmit(); void 0");
  for(let i=0;i<70;i++){if(await evaluate(cdp,"!document.querySelector('.lock')"))break;await sleep(50);}
  await openEditor(); await click(".select-trigger"); await sleep(230); await screenshot("28-select-popup.png");
  await check("小窗菜单保持在可见边界", "(()=>{const r=document.querySelector('.select-popup').getBoundingClientRect(); return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight})()");
  await check("空间不足时自动向上展开", "document.querySelector('.select-popup').dataset.side==='top'");
  await evaluate(cdp,"OTP.ui.closeSheet(); for(let i=0;i<35;i++) OTP.store.saveCategory({name:'测试分类'+i,icon:'folder'})");
  await openEditor(); await click(".select-trigger"); await key("End");
  await check("长列表可滚动到最后一项", "document.querySelector('.select-options').scrollTop>0 && document.querySelector('.select-option:last-child').classList.contains('is-active')");
  await evaluate(cdp,"OTP.ui.closeSheet()"); await sleep(450);
  await check("无遗留弹层", "!document.querySelector('.select-popup')");
  assert.deepEqual(errors,[]);console.log(`选择器 ${count} 项检查通过，无页面异常`);
} finally {cdp.close();browser.kill();server.close();}
