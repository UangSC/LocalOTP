/* 不设置 CDP 视口，直接验证浏览器给工具栏弹窗分配的首开和重开尺寸。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { CDP, evaluate, findBrowser, sleep, createBrowserProfile, cleanProfileOnExit } from './cdp.mjs';
const profile=createBrowserProfile('popup-size-'),extension=join(profile,'extension');
const headed=process.argv.includes('--headed'),openCount=headed?2:4;
mkdirSync(extension);
for(const path of ['manifest.json','popup.html','index.html','api.html','js','styles','assets']) cpSync(resolve(path),join(extension,path),{recursive:true});
writeFileSync(join(extension,'js/size-driver.js'),`window.addEventListener('load',()=>{
  const samples=[];let count=0;
  const timer=setInterval(()=>{
    const r=document.body.getBoundingClientRect();
    samples.push({width:innerWidth,height:innerHeight,bodyWidth:r.width,bodyHeight:r.height,rootOverflow:getComputedStyle(document.documentElement).overflow});
    if(++count===12){clearInterval(timer);chrome.runtime.sendMessage({type:'test:popup-size',samples}).then(()=>window.close());}
  },100);
});`);
writeFileSync(join(extension,'popup.html'),readFileSync(join(extension,'popup.html'),'utf8').replace('</body>','<script src="js/size-driver.js"></script></body>'));
writeFileSync(join(extension,'js/background.js'),readFileSync(join(extension,'js/background.js'),'utf8')+`\nglobalThis.popupSizeReports=[];chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.type==='test:popup-size'){popupSizeReports.push(m.samples);reply({ok:true});}});`);
const port=15000+Math.floor(Math.random()*20000);
const child=spawn(findBrowser(),[...(headed?[]:['--headless=new','--screen-info={1280x1000}']),'--edge-skip-compat-layer-relaunch','--no-first-run','--disable-sync','--window-size=1280,1000','--force-device-scale-factor=1.25',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,`--load-extension=${extension}`,'about:blank'],{stdio:'ignore',windowsHide:true});
cleanProfileOnExit(child,profile);let worker;
try {
  let sw;
  for(let i=0;i<100;i++){try{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();sw=list.find(t=>t.url.endsWith('/js/background.js'));if(sw)break;}catch{}await sleep(100);}
  assert.ok(sw);worker=await CDP.connect(sw.webSocketDebuggerUrl);
  for(let i=0;i<100;i++){if(await evaluate(worker,'!!globalThis.popupSizeReports'))break;await sleep(40);}
  const windowId=await evaluate(worker,'chrome.windows.getAll({windowTypes:["normal"]}).then(w=>w[0].id)');
  for(let n=0;n<openCount;n++) {
    await evaluate(worker,`chrome.windows.update(${windowId},{focused:true}).then(()=>chrome.action.openPopup({windowId:${windowId}}))`);
    let reports=[];
    for(let i=0;i<100;i++){reports=await evaluate(worker,'popupSizeReports');if(reports.length>n)break;await sleep(50);}
    assert.equal(reports.length,n+1,'工具栏弹窗必须完成测量');
    for(const sample of reports[n]) {
      assert.ok(sample.width>=400 && sample.width<=404,'工具栏不能缩成竖条：'+JSON.stringify(sample));
      assert.ok(sample.height>=480 && sample.height<=600,'工具栏高度异常：'+JSON.stringify(sample));
      assert.equal(sample.bodyWidth,402);
      assert.equal(sample.bodyHeight,600);
      assert.equal(sample.rootOverflow,'hidden');
    }
    console.log(`✓ 第 ${n+1} 次真实工具栏打开：${reports[n].at(-1).width}×${reports[n].at(-1).height}，12 次采样宽度稳定`);
    // 等浏览器销毁原生弹窗宿主，避免 close() 动画期间再次调用 openPopup。
    await sleep(1200);
  }
  mkdirSync(resolve('artifacts/popup-sizing'),{recursive:true});
  writeFileSync(resolve('artifacts/popup-sizing/native'+(process.argv.includes('--headed')?'-headed':'')+'.json'),JSON.stringify(await evaluate(worker,'popupSizeReports'),null,2));
} finally {await worker?.send('Browser.close').catch(()=>{});worker?.close();child.kill();}
