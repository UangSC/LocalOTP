/* 管理页真实悬停、可见滚动条及门禁中间帧验收，仅使用公开演示数据。 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CDP, evaluate, findBrowser, launchBrowser, startServer, setViewport, goto, sleep } from './cdp.mjs';
const {server,port}=await startServer(process.cwd());
const {process:browser,target}=await launchBrowser(findBrowser(),0,{gpu:true,hideScrollbars:false});
const page=await CDP.connect(target.webSocketDebuggerUrl);
const output=resolve('artifacts/management-interaction');mkdirSync(output,{recursive:true});
const ev=expression=>evaluate(page,expression),errors=[],report=[];
async function until(expression){for(let i=0;i<160;i++){if(await ev(expression))return;await sleep(25);}throw Error('等待超时：'+expression);}
async function shot(name){const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(output,name+'.png'),Buffer.from(data,'base64'));}
async function hover(selector){
  const point=await ev(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(330);
}
async function motion(entering,name){
  await ev('globalThis.__animSpeed=6');
  if(entering)await ev("document.querySelector('#pw-lock').value='management-test';document.querySelector('.lock-form').requestSubmit()");
  else await ev('void OTP.app.lock()');
  await until("document.body.dataset.gatePhase==='moving'");
  const keyframes=await ev(`(()=>{
    const targets=[document.querySelector('.flip-panel'),document.querySelector('#app'),document.querySelector('.lock-card')];
    globalThis.gateAnimations=targets.flatMap(n=>n.getAnimations());gateAnimations.forEach(a=>a.pause());
    return gateAnimations.map(a=>({target:a.effect.target.className,frames:a.effect.getKeyframes()}));
  })()`);
  assert.ok(keyframes.some(a=>a.target==='flip-panel'&&a.frames.some(f=>f.transform?.includes('scale'))),'背景必须真实展开或收回');
  for(const a of keyframes.filter(a=>a.target!=='flip-panel'))assert.ok(a.frames.every(f=>(!f.transform||f.transform==='none')&&(!f.filter||f.filter==='none')),'文字不能缩放或模糊');
  const frames=[];
  for(const [index,progress] of [0,.2,.4,.6,.8,.995].entries()){
    await ev(`gateAnimations.forEach(a=>a.currentTime=a.effect.getTiming().duration*${progress})`);
    await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    frames.push(await ev(`(()=>{const panel=document.querySelector('.flip-panel'),app=document.querySelector('#app'),card=document.querySelector('.lock-card');return {width:panel.getBoundingClientRect().width,opacity:Number(getComputedStyle(app).opacity),cardOpacity:Number(getComputedStyle(card).opacity),clip:getComputedStyle(app).clipPath,inert:document.querySelector('#screen').inert,transform:getComputedStyle(app).transform}})()`));
    await shot(name+'-'+index);
  }
  assert.ok(frames.every(f=>f.inert&&f.transform==='none'));
  assert.ok(frames.some(f=>f.opacity>.05&&f.opacity<.95),'内容必须逐渐显现或消失，不能硬切');
  assert.ok(entering?frames[0].width<frames[5].width:frames[0].width>frames[5].width);
  await ev('gateAnimations.forEach(a=>a.finish());delete globalThis.__animSpeed');
  await until('!document.body.dataset.gateMotion');
  assert.ok(await ev('!document.querySelector(".flip-panel") && !document.querySelector("#app").style.willChange'));
  assert.equal(await ev('!!document.querySelector(".lock")'),!entering);
  report.push({name,frames});console.log('✓ '+name+'：背景完整形变、内容渐变、文字不缩放、交互锁定和清理');
}
try{
  await page.send('Runtime.enable');page.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await setViewport(page,1280,820,1);await goto(page,`http://127.0.0.1:${port}/index.html`);
  await ev("OTP.store.setPassword('management-test')");await goto(page,`http://127.0.0.1:${port}/index.html`);
  await motion(true,'first-unlock');
  for(const theme of ['light','dark']){
    await ev(`OTP.store.patchSettings({theme:${JSON.stringify(theme)},view:'list'});OTP.app.applyTheme(false);OTP.app.renderAll({stagger:false})`);await sleep(250);
    for(const selector of ['#nav .nav-item:first-child','#nav .nav-item:last-child']){
      await hover(selector);
      const metrics=await ev(`(()=>{const n=document.querySelector('#nav'),button=document.querySelector(${JSON.stringify(selector)}),a=n.getBoundingClientRect(),b=button.getBoundingClientRect();return {width:n.clientWidth,scrollWidth:n.scrollWidth,height:n.clientHeight,scrollHeight:n.scrollHeight,rightGap:a.right-b.right,leftGap:b.left-a.left,overflow:getComputedStyle(n).overflowX}})()`);
      assert.ok(metrics.scrollWidth<=metrics.width,'悬停不能产生横向溢出');
      assert.equal(metrics.overflow,'hidden');assert.ok(metrics.rightGap>=4&&metrics.leftGap>=4,'阴影和焦点环必须有留白');
    }
    await shot('navigation-'+theme);
    for(const view of ['list','grid']){
      await ev(`OTP.store.patchSettings({view:${JSON.stringify(view)}});OTP.app.renderAll({stagger:false})`);await sleep(300);
      await hover('.item');
      const style=await ev("(()=>{const s=getComputedStyle(document.querySelector('.item .code'));return {shadow:s.boxShadow,border:s.borderWidth,background:s.backgroundColor,outline:s.outlineStyle}})()");
      assert.equal(style.shadow,'none',view+' 验证码不能有透明阴影框');assert.equal(style.border,'0px');assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.outline,'none');
      await shot('code-'+view+'-'+theme);
    }
    await motion(false,'lock-'+theme);await motion(true,'unlock-'+theme);
  }
  await ev("(async()=>{for(let i=0;i<35;i++)OTP.store.saveCategory({name:'公开分类 '+i,icon:'tag'});await OTP.store.persist();OTP.app.renderAll({stagger:false})})()");
  await hover('#nav .nav-item:last-child');
  assert.ok(await ev("(()=>{const n=document.querySelector('#nav');return n.scrollHeight>n.clientHeight&&n.scrollTop>0&&n.scrollWidth<=n.clientWidth&&n.lastElementChild.getBoundingClientRect().height>=34})()"),'长导航仍可纵向滚动且按钮不被压扁');
  await shot('navigation-long');
  await ev('globalThis.__animSpeed=6;void OTP.app.lock()');await until("document.body.dataset.gatePhase==='moving'");
  await setViewport(page,1100,760,1);await until('!document.body.dataset.gateMotion');
  assert.ok(await ev('!!document.querySelector(".lock")&&!document.querySelector(".flip-panel")&&!document.querySelector(".lock").inert'));
  await ev('delete globalThis.__animSpeed');
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await ev("document.querySelector('#pw-lock').value='management-test';document.querySelector('.lock-form').requestSubmit()");await until('!document.querySelector(".lock")');
  assert.ok(await ev('!document.querySelector(".flip-panel")&&!document.body.dataset.gateMotion'));
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(output,'verification.json'),JSON.stringify(report,null,2));
  console.log('导航、列表/卡片验证码、首次与反向动画、长导航、窗口变化和减少动态效果检查通过');
}finally{await page.send('Browser.close').catch(()=>{});page.close();browser.kill();server.close();}
