/* 使用 chrome.action.openPopup 真正打开工具栏弹窗。
   仅在隔离复制品注入驱动脚本，执行实际表单与按钮，不替换授权/窗口实现。 */
import { spawn } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { CDP, evaluate, findBrowser, sleep, createBrowserProfile, cleanProfileOnExit } from './cdp.mjs';
const profile = createBrowserProfile('real-popup-'), extension = join(profile, 'extension'), port = 15000+Math.floor(Math.random()*20000);
const denyUnlock = process.argv.includes('--deny-unlock');
const openPage = process.argv.includes('--open-page');
mkdirSync(extension);
for (const path of ['manifest.json','popup.html','index.html','api.html','js','styles','assets']) cpSync(resolve(path), join(extension,path), {recursive:true});
if(denyUnlock)writeFileSync(join(extension,'js/access.js'),readFileSync(join(extension,'js/access.js'),'utf8')+'\nOTP.access.unlock=async()=>false;\n');
const driver = `
(function(){
  let stage=0;
  const timer=setInterval(async()=>{
    if(!window.OTP?.app) return;
    if(location.pathname==='/index.html'){
      if(document.querySelector('#screen.is-in')){clearInterval(timer);chrome.runtime.sendMessage({type:'test:management-ready',locked:!!document.querySelector('.lock'),ticketRemoved:!location.hash});}
      return;
    }
    const floating=new URLSearchParams(location.search).has('floating');
    if(floating){
      if(document.querySelector('#screen.is-in')){clearInterval(timer);chrome.runtime.sendMessage({type:'test:floating-ready',locked:!!document.querySelector('.lock')});}
      return;
    }
    if(stage===0 && document.querySelector('#pw-lock2')){
      stage=1;
      document.querySelector('#pw-lock').value='popup-context-test';
      document.querySelector('#pw-lock2').value='popup-context-test';
      document.querySelector('.lock-form').requestSubmit();
    }
    if(stage===1 && !document.querySelector('.lock') && document.querySelector('#screen.is-in')){
      stage=2;clearInterval(timer);
      chrome.runtime.sendMessage({type:'test:unlocked'});
      document.querySelector('${openPage ? '#open-page-btn' : '#pin-window-btn'}').click();
    }
    if(stage===1 && document.querySelector('.lock') && !document.querySelector('#pw-lock2')){
      clearInterval(timer);chrome.runtime.sendMessage({type:'test:blocked',inert:document.querySelector('#screen').inert});
    }
  },50);
})();`;
writeFileSync(join(extension,'js/test-driver.js'), driver);
const html = readFileSync(join(extension,'popup.html'),'utf8').replace('</body>','<script src="js/test-driver.js"></script></body>');
writeFileSync(join(extension,'popup.html'),html);
if(openPage)writeFileSync(join(extension,'index.html'),readFileSync(join(extension,'index.html'),'utf8').replace('</body>','<script src="js/test-driver.js"></script></body>'));
const observer = `
globalThis.popupContextReport={messages:[],unlocked:false,floating:false,management:false,ticketRemoved:false,blocked:false};
chrome.runtime.onMessage.addListener((m,s)=>{
 if(m.type==='localotp:access')popupContextReport.messages.push({action:m.action,hasDocumentId:!!s.documentId,hasClientId:!!m.clientId,hasProof:!!m.proof,path:new URL(s.url).pathname});
 if(m.type==='test:unlocked')popupContextReport.unlocked=true;
 if(m.type==='test:floating-ready')popupContextReport.floating=!m.locked;
 if(m.type==='test:management-ready'){popupContextReport.management=!m.locked;popupContextReport.ticketRemoved=m.ticketRemoved;}
 if(m.type==='test:blocked')popupContextReport.blocked=m.inert;
});`;
writeFileSync(join(extension,'js/background.js'),readFileSync(join(extension,'js/background.js'),'utf8')+observer);
const child=spawn(findBrowser(),['--headless=new', '--edge-skip-compat-layer-relaunch','--no-first-run','--disable-sync',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,`--load-extension=${extension}`,'about:blank'],{stdio:'ignore',windowsHide:true});
cleanProfileOnExit(child,profile);
let worker;
try {
  let sw;
  for(let i=0;i<100;i++){try{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();sw=list.find(t=>t.url.endsWith('/js/background.js'));if(sw)break;}catch{}await sleep(100)}
  assert.ok(sw,'扩展后台未启动'); worker=await CDP.connect(sw.webSocketDebuggerUrl);
  for(let i=0;i<100;i++){if(await evaluate(worker,'!!globalThis.popupContextReport && !!globalThis.OTP?.store?.state.ready'))break;await sleep(40)}
  await evaluate(worker,'chrome.action.openPopup()');
  let report;
  for(let i=0;i<160;i++){report=await evaluate(worker,'popupContextReport');if(report.floating||report.management||report.blocked)break;await sleep(50)}
  if(denyUnlock){
    assert.ok(report.blocked,'首次密码创建后授权失败必须保持门禁');assert.ok(!report.unlocked&&!report.floating&&!report.management,'授权失败不能展示账号或创建窗口');
    console.log('真实工具栏授权拒绝：保持门禁、不进入账号区且不创建浮窗，2 项通过。');
  } else {
  assert.ok(report.unlocked,'真实工具栏首次创建密码没有完成解锁');
  assert.ok(report.messages.some(m=>m.action==='unlock'&&!m.hasDocumentId&&m.hasClientId),'必须覆盖缺少 documentId 的真实 POPUP，而非普通标签页');
  assert.ok(report.messages.some(m=>m.action===(openPage?'page':'float')&&m.hasProof),'打开页面请求没有携带已验证授权');
  assert.ok(openPage ? report.management && report.ticketRemoved : report.floating,'真正的工具栏弹窗未能打开已授权页面');
  console.log(openPage?'真实工具栏弹窗：首次创建密码、无 documentId 身份、管理页接续授权、票据清除，4 项通过。':'真实工具栏弹窗：首次创建密码、无 documentId 身份、授权置顶、独立窗口接续，4 项通过。');
  console.log(JSON.stringify(report));
  }
} finally {worker?.close();child.kill()}
