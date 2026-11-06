/* 截图链路回归；程序打开弹窗不授予 activeTab，测试副本临时加入截图 API 要求的 all_urls，仅访问本机公开夹具。 */
import { spawn } from 'node:child_process';
import { cpSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import assert from 'node:assert/strict';
import { CDP,evaluate,sleep,findBrowser,createBrowserProfile,cleanProfileOnExit,startServer,shadowCall } from './cdp.mjs';
const profile=createBrowserProfile('capture-'),extension=join(profile,'extension'),port=15000+Math.floor(Math.random()*20000);
mkdirSync(extension);for(const name of ['manifest.json','popup.html','index.html','api.html','js','styles','assets'])cpSync(resolve(name),join(extension,name),{recursive:true});
const copyProbe=`
(()=>{const actualCopy=OTP.copyText;OTP.copyText=async(text,container)=>{
 Object.defineProperty(globalThis,'isSecureContext',{value:false,configurable:true});
 document.execCommand=()=>{const field=container.querySelector('textarea');globalThis.copyProbe=!!field&&container.open&&field.value===text;return copyProbe;};
 const ok=await actualCopy(text,container);chrome.runtime.sendMessage({type:'test:copy-probe',ok,clean:!container.querySelector('textarea')});return ok;
};})();`;
writeFileSync(join(extension,'js/scan-page.js'),readFileSync(join(extension,'js/scan-page.js'),'utf8')+copyProbe);
const manifest=JSON.parse(readFileSync(join(extension,'manifest.json'),'utf8'));
manifest.host_permissions=['<all_urls>'];writeFileSync(join(extension,'manifest.json'),JSON.stringify(manifest));
const fixture=JSON.parse(readFileSync(new URL('./fixtures/qr-public.json',import.meta.url),'utf8'));
const target=join(profile,'target');mkdirSync(target);mkdirSync(resolve('artifacts'),{recursive:true});
const rects=fixture.matrix.flatMap((row,y)=>[...row].map((v,x)=>v==='1'?`<rect x="${x+4}" y="${y+4}" width="1" height="1"/>`:'' )).join('');
writeFileSync(join(target,'index.html'),`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'"></head><body style="padding:24px;background:white"><h1>公开 OTP 测试二维码</h1><svg width="280" height="280" viewBox="0 0 ${fixture.matrix.length+8} ${fixture.matrix.length+8}"><rect width="100%" height="100%" fill="white"/>${rects}</svg></body></html>`);
const server=await startServer(target);
const driver=`let stage=0;const timer=setInterval(async()=>{if(!globalThis.OTP?.app)return;if(stage===0&&document.querySelector('#pw-lock2')){stage=1;document.querySelector('#pw-lock').value='capture-test';document.querySelector('#pw-lock2').value='capture-test';document.querySelector('.lock-form').requestSubmit();}if(stage===1&&!document.querySelector('.lock')&&document.querySelector('#screen.is-in')){stage=2;clearInterval(timer);chrome.runtime.sendMessage({type:'test:popup-metrics',height:innerHeight,bodyHeight:document.body.scrollHeight});document.querySelector('#scan-btn').click();document.querySelector('#scan-capture').click();}},50);`;
writeFileSync(join(extension,'js/scan-driver.js'),driver);
writeFileSync(join(extension,'popup.html'),readFileSync(join(extension,'popup.html'),'utf8').replace('</body>','<script src="js/scan-driver.js"></script></body>'));
writeFileSync(join(extension,'js/background.js'),readFileSync(join(extension,'js/background.js'),'utf8')+`\nglobalThis.captureReport=null;globalThis.popupMetrics=null;globalThis.copyResult=null;let scanStart;const realScan=OTP.scanBackground;OTP.scanBackground=async(...args)=>{scanStart=args;const result=await realScan(...args);captureReport={...result,dataUrl:undefined};return result;};chrome.runtime.onMessage.addListener(m=>{if(m.type==='test:copy-probe')copyResult={ok:m.ok,clean:m.clean};if(m.type==='test:scan-result')captureReport=m.result;if(m.type==='test:popup-metrics')popupMetrics={height:m.height,bodyHeight:m.bodyHeight};});`);
const child=spawn(findBrowser(),['--headless=new', '--edge-skip-compat-layer-relaunch','--window-size=1280,1000','--screen-info={1280x1000}','--no-first-run','--disable-sync',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,`--load-extension=${extension}`,'http://127.0.0.1:'+server.port+'/index.html'],{stdio:'ignore',windowsHide:true});cleanProfileOnExit(child,profile);
let worker,page,floating,secondPage;
try{
 let sw;const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 for(let i=0;i<100;i++){try{sw=(await targets()).find(t=>t.url.endsWith('/js/background.js'));if(sw)break;}catch{}await sleep(100);}
 assert.ok(sw);worker=await CDP.connect(sw.webSocketDebuggerUrl);
 for(let i=0;i<100;i++){try{if(await evaluate(worker,'!!globalThis.OTP?.store?.state.ready && typeof captureReport!==\"undefined\"'))break;}catch{}await sleep(50);}
 await evaluate(worker,'chrome.action.openPopup()');
 let report;for(let i=0;i<180;i++){report=await evaluate(worker,'captureReport');if(report)break;await sleep(50);}
 console.log('工具栏截图结果：',report);assert.ok(report?.ok,'本机夹具授权下未能截图');
 const targetPage=(await targets()).find(t=>t.url.startsWith('http://127.0.0.1:'));
 assert.ok(targetPage);page=await CDP.connect(targetPage.webSocketDebuggerUrl);await page.send('Page.bringToFront');
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(page,expression))return;await sleep(40);}throw Error('等待超时：'+expression);};
 await wait('!!document.querySelector("#localotp-crop-host")');
 assert.equal(await evaluate(worker,'chrome.tabs.query({}).then(t=>t.length)'),1,'不得新建标签页');
 assert.equal(await evaluate(page,'document.querySelector("#localotp-crop-host").shadowRoot'),null,'站点脚本不能读取蒙版内容');
 const guards=await evaluate(worker,`(async()=>{const job=(await chrome.storage.session.get('localotp:scan:v2'))['localotp:scan:v2'];const sender={id:chrome.runtime.id,tab:{id:job.tabId},frameId:0,documentId:job.documentId};const message={type:'localotp:scan-page',action:'code',token:job.token};const results=await Promise.all([OTP.scanPageRequest({...message,token:'forged'},sender,accessService),OTP.scanPageRequest(message,{...sender,documentId:'other-document'},accessService),OTP.scanPageRequest(message,{...sender,frameId:1},accessService)]);return results.every(r=>!r.ok)})()`);
 assert.ok(guards,'伪造令牌、其他文档或子框架不能复用扫码授权');

 const cropImage=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve('artifacts/capture-overlay.png'),Buffer.from(cropImage.data,'base64'));
 await shadowCall(page,'localotp-crop-host','footer button:nth-child(2)','function(){this.click()}');
 await wait('!!document.querySelector("#localotp-scan-result")');
 let account;for(let i=0;i<150;i++){account=await shadowCall(page,'localotp-scan-result','#scan-page-email','function(){return this.value}');if(account)break;await sleep(40);}
 assert.equal(account,'demo@example.invalid','真实截图必须正确解析');
 const resultImage=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve('artifacts/capture-result.png'),Buffer.from(resultImage.data,'base64'));
 await shadowCall(page,'localotp-scan-result','#scan-page-copy','function(){this.click()}');
 for(let i=0;i<100;i++){if(await evaluate(worker,'!!copyResult'))break;await sleep(40);}
 assert.deepEqual(await evaluate(worker,'copyResult'),{ok:true,clean:true},'后备复制在模态区域内执行且临时文本已清除');
 await shadowCall(page,'localotp-scan-result','#scan-page-save','function(){this.click()}');
 for(let i=0;i<150;i++){if(await evaluate(worker,'OTP.store.accounts().length===1'))break;await sleep(40);}
 assert.equal(await evaluate(worker,'OTP.store.accounts()[0].period'),45);
 await wait('!document.querySelector("#localotp-scan-result")');
 assert.equal(await evaluate(worker,"chrome.storage.session.get('localotp:scan:v2').then(v=>!!v['localotp:scan:v2'])"),false);
 await wait('!document.querySelector("#localotp-scan-result")');
 const normalWindow=await evaluate(worker,'chrome.windows.getLastFocused({windowTypes:["normal"]}).then(w=>w.id)');
 const secondUrl='http://127.0.0.1:'+server.port+'/index.html?current-tab';
 const secondTab=await evaluate(worker,`chrome.tabs.create({url:${JSON.stringify(secondUrl)},windowId:${normalWindow},active:true})`);
 await evaluate(worker,'chrome.windows.create({url:chrome.runtime.getURL("popup.html")+"?floating=1",type:"popup",width:430,height:740,focused:true})');
 let floatingTarget;
 for(let i=0;i<100;i++){floatingTarget=(await targets()).find(t=>t.url.includes('popup.html?floating=1'));if(floatingTarget)break;await sleep(50);}
 assert.ok(floatingTarget);floating=await CDP.connect(floatingTarget.webSocketDebuggerUrl);
 const until=async(cdp,expression)=>{for(let i=0;i<150;i++){if(await evaluate(cdp,expression))return;await sleep(40);}throw Error('等待超时：'+expression);};
 await until(floating,'!!document.querySelector("#screen.is-in") && !document.querySelector(".lock")');
 const secondTarget=(await targets()).find(t=>t.url===secondUrl);assert.ok(secondTarget);secondPage=await CDP.connect(secondTarget.webSocketDebuggerUrl);
 await evaluate(floating,"globalThis.pickerCalls=0;OTP.captureFromPicker=async()=>{pickerCalls++;throw Error('小窗不得打开来源选择器')};document.querySelector('#scan-btn').click();document.querySelector('#scan-capture').click()");
 await until(secondPage,'!!document.querySelector("#localotp-crop-host")');
 assert.equal(await evaluate(worker,"chrome.storage.session.get('localotp:scan:v2').then(v=>v['localotp:scan:v2'].tabId)"),secondTab.id,'常驻小窗必须选择用户当前激活的网页');
 assert.equal(await evaluate(floating,'pickerCalls'),0,'常驻小窗不走来源选择器');
 assert.equal(await evaluate(floating,'!!document.querySelector("#localotp-crop-host")'),false,'小窗不缩放展示网页');
 assert.equal(await evaluate(page,'!!document.querySelector("#localotp-crop-host")'),false,'不会继续截取先前标签页');
 await shadowCall(secondPage,'localotp-crop-host','footer button:first-child','function(){this.click()}');
 await until(worker,"chrome.storage.session.get('localotp:scan:v2').then(v=>!v['localotp:scan:v2'])");
 console.log('常驻小窗 → 当前激活网页蒙版，未使用选择器或缩小网页，通过。');
 await evaluate(floating,'OTP.ui.closeAll()');await sleep(350);
 // 新建但未聚焦的普通窗口不能取代用户刚刚操作的网页。
 const backgroundWindow=await evaluate(worker,`chrome.windows.create({url:${JSON.stringify('http://127.0.0.1:'+server.port+'/index.html?background-tab')},focused:false,type:'normal'})`);
 await secondPage.send('Page.bringToFront');
 await until(worker,`chrome.storage.session.get('localotp:scan-windows:v1').then(v=>v['localotp:scan-windows:v1']?.[0]===${normalWindow})`);
 await floating.send('Page.bringToFront');
 await evaluate(floating,'document.querySelector("#pin-window-btn").click()');
 await until(floating,'!!documentPictureInPicture.window?.document.querySelector("iframe")?.contentDocument?.querySelector("#screen.is-in")');
 await evaluate(floating,`(()=>{const frame=documentPictureInPicture.window.document.querySelector('iframe'),w=frame.contentWindow;w.pickerCalls=0;w.OTP.captureFromPicker=async()=>{w.pickerCalls++;throw Error('置顶小窗不得打开来源选择器')};frame.contentDocument.querySelector('#scan-btn').click();frame.contentDocument.querySelector('#scan-capture').click()})()`);
 await until(secondPage,'!!document.querySelector("#localotp-crop-host")');
 assert.equal(await evaluate(floating,'documentPictureInPicture.window.document.querySelector("iframe").contentWindow.pickerCalls'),0);
 assert.equal(await evaluate(floating,'!!documentPictureInPicture.window.document.querySelector("iframe").contentDocument.querySelector("#localotp-crop-host")'),false);
 assert.equal(await evaluate(worker,"chrome.storage.session.get('localotp:scan:v2').then(v=>v['localotp:scan:v2'].tabId)"),secondTab.id,'多个浏览器窗口时仍选用户刚操作的窗口');
 await shadowCall(secondPage,'localotp-crop-host','footer button:first-child','function(){this.click()}');
 await until(worker,"chrome.storage.session.get('localotp:scan:v2').then(v=>!v['localotp:scan:v2'])");
 await evaluate(floating,'documentPictureInPicture.window.close()');
 await evaluate(worker,`chrome.windows.remove(${backgroundWindow.id})`);
 console.log('真实置顶小窗 → 当前网页蒙版，通过。');
 await evaluate(worker,`chrome.tabs.remove(${secondTab.id})`);
 await evaluate(worker,`chrome.tabs.update(${JSON.stringify(await evaluate(worker,'chrome.tabs.query({windowId:'+normalWindow+'}).then(t=>t[0].id)'))},{active:true})`);
 await evaluate(worker,'OTP.scanBackground(...scanStart)');await wait('!!document.querySelector("#localotp-crop-host")');
 await evaluate(worker,"accessService.request({action:'revoke'},'test')");await wait('!document.querySelector("#localotp-crop-host")');
 assert.equal(await evaluate(worker,'chrome.tabs.query({windowType:"normal"}).then(t=>t.length)'),1);
 const popupMetrics=await evaluate(worker,'popupMetrics');console.log('工具栏尺寸：',popupMetrics);
 assert.ok(popupMetrics.bodyHeight<=popupMetrics.height,'工具栏文档不产生整页纵向溢出');
 console.log('原网页蒙版 → 识别预览 → 保存 OTP、没有新标签、封闭蒙版、锁定撤销和会话清理，全部通过。');

}catch(error){
 console.log('扫码诊断',await evaluate(worker,'chrome.storage.session.get("localotp:scan-windows:v1").then(w=>({result:captureReport,window:w}))').catch(()=>null));
 console.log('窗口诊断',JSON.stringify(await evaluate(worker,'chrome.windows.getAll({populate:true}).then(w=>w.map(v=>({id:v.id,type:v.type,focused:v.focused,alwaysOnTop:v.alwaysOnTop,tabs:v.tabs?.map(t=>({id:t.id,url:t.url,active:t.active}))})))').catch(()=>null)));
 if(floating)console.log('小窗状态',await evaluate(floating,`({status:document.querySelector('.scan-status')?.textContent,pipStatus:documentPictureInPicture.window?.document.querySelector('iframe')?.contentDocument.querySelector('.scan-status')?.textContent})`).catch(()=>null));
 throw error;
}finally{await worker?.send('Browser.close').catch(()=>{});worker?.close();page?.close();floating?.close();secondPage?.close();child.kill();server.server.close();}
