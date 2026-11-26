/* 界面修整：截图选择器、清晰动画、光标、窗口高度和倒计时字号。 */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {CDP,evaluate,findBrowser,launchBrowser,startServer,setViewport,goto,sleep,shadowCall} from './cdp.mjs';
const {server,port}=await startServer(process.cwd());const {process:browser,target}=await launchBrowser(findBrowser(),0,{gpu:true});
const page=await CDP.connect(target.webSocketDebuggerUrl),base='http://127.0.0.1:'+port,shots=resolve('artifacts/ui-polish');mkdirSync(shots,{recursive:true});
const fixture=JSON.parse(readFileSync('tools/fixtures/qr-public.json','utf8'));const errors=[];let count=0;
const check=(text,ok)=>{assert.ok(ok,text);console.log('✓ '+text);count++;};
const wait=async expression=>{for(let i=0;i<150;i++){try{if(await evaluate(page,expression))return;}catch{}await sleep(40);}throw Error('等待超时：'+expression);};
const shot=async name=>{const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(shots,name+'.png'),Buffer.from(data,'base64'));};
const click=selector=>evaluate(page,`document.querySelector(${JSON.stringify(selector)}).click()`);
async function unlock(){await evaluate(page,"document.querySelector('#pw-lock').value='polish-test';document.querySelector('.lock-form').requestSubmit()");await wait('!document.querySelector(".lock")');}
try{
 await page.send('Runtime.enable');page.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
 await setViewport(page,1360,900,1);await goto(page,base+'/index.html');await evaluate(page,"OTP.store.setPassword('polish-test')");await goto(page,base+'/index.html');await unlock();
 check('首次解锁结束没有遗留动画层',await evaluate(page,"!document.querySelector('.flip-panel') && !document.body.dataset.gateMotion"));
 check('普通区域与按钮没有编辑光标',await evaluate(page,"getComputedStyle(document.querySelector('.main-title')).cursor==='default' && getComputedStyle(document.querySelector('.row-email')).cursor==='pointer' && getComputedStyle(document.querySelector('#page-add')).cursor==='pointer'"));
 check('真实编辑框保留文本光标',await evaluate(page,"getComputedStyle(document.querySelector('#page-search')).cursor==='text'"));
 check('管理页倒计时数字至少 13px',await evaluate(page,"[...document.querySelectorAll('.ring-num')].every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)"));
 await evaluate(page,"OTP.store.patchSettings({view:'grid'});OTP.app.renderAll({stagger:false})");await sleep(250);
 check('卡片数字至少 14px，圆环至少 36px',await evaluate(page,"parseFloat(getComputedStyle(document.querySelector('.card .ring-num')).fontSize)>=14 && document.querySelector('.card .ring').getBoundingClientRect().width>=36"));
 const motion=await evaluate(page,"(()=>{OTP.list.reveal();return [...document.querySelectorAll('.item')].flatMap(n=>n.getAnimations()).flatMap(a=>a.effect.getKeyframes()).every(f=>!f.filter?.includes('blur') && (!f.transform||f.transform==='none'))})()");
 check('列表文字入场没有缩放与模糊滤镜',motion);await sleep(350);
 await evaluate(page,"document.querySelector('.code').classList.add('is-new')");
 check('验证码换轮关键帧没有 blur 或缩放',await evaluate(page,"document.querySelector('.code').getAnimations().flatMap(a=>a.effect.getKeyframes()).every(f=>!f.filter?.includes('blur') && (!f.transform||f.transform==='none'))"));
 await click('#side-settings');await sleep(100);
 check('设置抽屉采用裁切，背景不模糊',await evaluate(page,"getComputedStyle(document.querySelector('.sheet')).transform==='none' && getComputedStyle(document.querySelector('.veil')).backdropFilter==='none'"));
 await evaluate(page,'OTP.ui.closeAll()');await sleep(350);await click('#scan-btn');await sleep(300);
 check('本地预览的截取网页按钮可点击',await evaluate(page,"!OTP.access.available && !document.querySelector('#scan-capture').disabled"));
 await evaluate(page,`(()=>{const matrix=${JSON.stringify(fixture.matrix)},c=document.createElement('canvas');c.width=c.height=(matrix.length+8)*6;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';matrix.forEach((r,y)=>[...r].forEach((v,z)=>{if(v==='1')x.fillRect((z+4)*6,(y+4)*6,6,6)}));globalThis.pickerCalls=0;const create=document.createElement.bind(document);document.createElement=(tag,...args)=>{const node=create(tag,...args);if(tag==='video')globalThis.testVideo=node;return node;};Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{pickerCalls++;globalThis.testStream=c.captureStream(0);const track=testStream.getVideoTracks()[0],timer=setInterval(()=>{if(track.readyState==='ended'){clearInterval(timer);return;}x.fillStyle='white';x.fillRect(0,0,1,1);track.requestFrame()},50);return testStream}})})()`);
 await click('#scan-capture');await wait('!!document.querySelector("#localotp-crop-host")');
 check('管理页调起来源选择器并在当前页显示蒙版',await evaluate(page,'pickerCalls===1 && location.pathname.endsWith("index.html")'));
 check('取得截图后立即结束视频共享',await evaluate(page,'testStream.getTracks().every(t=>t.readyState==="ended")'));
 await shadowCall(page,'localotp-crop-host','footer button:nth-child(2)','function(){this.click()}');await wait('document.querySelector(".scan-pane").classList.contains("has-result")');
 check('选择器画面可解析原始 OTP 参数',await evaluate(page,"document.querySelector('#scan-name').value==='demo@example.invalid' && document.querySelector('.scan-meta').textContent.includes('8 位')"));
 const contrastCheck=async(theme,color,disabled=false)=>evaluate(page,`(()=>{
  OTP.store.patchSettings({theme:${JSON.stringify(theme)},colorScheme:${JSON.stringify(color)}});OTP.app.applyTheme(false);
  const input=document.querySelector('#scan-name');input.disabled=${disabled};
  const ctx=document.createElement('canvas').getContext('2d');ctx.canvas.width=ctx.canvas.height=1;
  const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255)};
  const lum=color=>rgb(color).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const bg=getComputedStyle(input.closest('.field-input')).backgroundColor;
  return {text:ratio(getComputedStyle(input).color,bg),placeholder:ratio(getComputedStyle(input,'::placeholder').color,bg)};
 })()`);
 const ratios=[];
 for(const [theme,color] of [['light','ocean'],['light','aurora'],['light','sunset'],['dark','midnight'],['dark','nebula'],['dark','ember']]){
  const normal=await contrastCheck(theme,color),disabled=await contrastCheck(theme,color,true);ratios.push({theme,color,normal,disabled});
  check(`${theme}/${color} 切换瞬间输入与占位文字对比度合格`,normal.text>=4.5 && normal.placeholder>=4.5 && disabled.text>=4.5);
 }
 writeFileSync(resolve(shots,'input-contrast.json'),JSON.stringify(ratios,null,2));
 await contrastCheck('dark','midnight');await sleep(300);await shot('picker-result-dark');

 await click('.scan-again');await evaluate(page,"Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{throw new DOMException('cancel','NotAllowedError')}})");await click('#scan-capture');await wait('!document.querySelector("#scan-capture").disabled');
 check('取消来源选择后按钮仍可再次操作',await evaluate(page,"document.querySelector('.scan-status').textContent.includes('已取消')"));
 await goto(page,base+'/popup.html');await setViewport(page,402,680,1);await unlock();
 check('高窗口利用 680px 并保持底部操作可见',await evaluate(page,"document.querySelector('.shell').getBoundingClientRect().height===680 && document.querySelector('.dock').getBoundingClientRect().bottom<=innerHeight"));
 check('弹窗圆环数字至少 13px',await evaluate(page,"parseFloat(getComputedStyle(document.querySelector('.quick .ring-num')).fontSize)>=13"));await shot('popup-tall-dark');
 await setViewport(page,402,514,1);check('空间不足时贴合浏览器实际高度',await evaluate(page,"document.querySelector('.shell').getBoundingClientRect().height===514 && document.querySelector('.dock').getBoundingClientRect().bottom<=innerHeight"));
 check('无页面脚本异常',errors.length===0);console.log(count+' 项界面与选择器回归通过');
}catch(error){console.log(await evaluate(page,"({status:document.querySelector('.scan-status')?.textContent,calls:globalThis.pickerCalls,video:globalThis.testVideo&&{ready:testVideo.readyState,width:testVideo.videoWidth,paused:testVideo.paused,muted:testVideo.muted,error:testVideo.error?.message},tracks:globalThis.testStream?.getTracks().map(t=>({state:t.readyState,muted:t.muted})),errors:"+JSON.stringify(errors)+"})"));throw error;}finally{await page.send('Browser.close').catch(()=>{});page.close();browser.kill();server.close();}
