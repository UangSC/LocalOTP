/* 五色 × 两种主题：真实设置点击、文字对比度、字体层级和偏好持久化。 */
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {CDP,evaluate,findBrowser,goto,launchBrowser,setViewport,sleep,startServer} from "./cdp.mjs";
const {server,port}=await startServer(process.cwd());
const {process:browser,target}=await launchBrowser(findBrowser(),9379);
const cdp=await CDP.connect(target.webSocketDebuggerUrl);
const output=resolve("artifacts/colors");mkdirSync(output,{recursive:true});
let count=0;const errors=[];const metrics=[];
async function check(name,condition){assert.ok(condition,name);count++;console.log("✓ "+name);}
async function click(selector){
  const point=await evaluate(cdp,`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',behavior:'instant'});const r=n.getBoundingClientRect();const p={x:r.left+r.width/2,y:r.top+r.height/2};if(!n.contains(document.elementFromPoint(p.x,p.y)))throw new Error('目标被遮挡：'+n.className+' ← '+document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,180));return p})()`);
  for(const type of ["mousePressed","mouseReleased"])await cdp.send("Input.dispatchMouseEvent",{type,...point,button:"left",clickCount:1});
  await sleep(650);
}
async function shot(name){const {data}=await cdp.send("Page.captureScreenshot",{format:"png"});writeFileSync(resolve(output,name+".png"),Buffer.from(data,"base64"));}
async function unlock(){
  await evaluate(cdp,"document.querySelector('#pw-lock').value='color-test';document.querySelector('.lock-form').requestSubmit();void 0");
  for(let i=0;i<100;i++){if(await evaluate(cdp,"!document.querySelector('.lock')"))return;await sleep(40);}
  throw new Error("解锁超时");
}
try{
  await cdp.send("Page.enable");await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown",p=>errors.push(p.exceptionDetails.text));
  await setViewport(cdp,1440,900,1);
  const url=`http://127.0.0.1:${port}`;
  await goto(cdp,url+"/index.html");await evaluate(cdp,"OTP.store.setPassword('color-test')");await goto(cdp,url+"/index.html?test");await unlock();
  await evaluate(cdp,"OTP.sheets.openManage('settings')");await sleep(500);
  await check("主题下方有且仅有五个色系",await evaluate(cdp,"document.querySelectorAll('.color-choice').length===5 && document.querySelector('.color-setting').previousElementSibling.textContent.includes('主题')"));
  for(const theme of ["light","dark"]){
    await click(`.settings-pane .seg-btn[data-id="${theme}"]`);
    for(const color of ["purple","green","blue","pink","mono"]){
      await click(`[data-color-choice="${color}"]`);
      await check(`${theme}/${color} 点击立即更新`,await evaluate(cdp,`document.documentElement.dataset.colorScheme==='${color}' && document.documentElement.dataset.theme==='${theme}' && OTP.store.settings().colorScheme==='${color}'`));
      await check(`${theme}/${color} 单选与键盘焦点一致`,await evaluate(cdp,`document.querySelectorAll('.color-choice[aria-checked="true"]').length===1 && document.querySelector('[data-color-choice="${color}"]').tabIndex===0`));
      const measured=await evaluate(cdp,`(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255)};
        const lum=color=>rgb(color).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
        const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
        const pane=document.querySelector('.settings-pane');const title=pane.querySelector('.set-label b > span');const desc=pane.querySelector('.set-label > span');
        const surface=getComputedStyle(pane.querySelector('.set-card')).backgroundColor;
        const variables=getComputedStyle(document.body);
        return {title:ratio(getComputedStyle(title).color,surface),description:ratio(getComputedStyle(desc).color,surface),titleWeight:getComputedStyle(title).fontWeight,descriptionWeight:getComputedStyle(desc).fontWeight,
          primary:Math.min(ratio(variables.getPropertyValue('--on-brand'),variables.getPropertyValue('--action-a')),ratio(variables.getPropertyValue('--on-brand'),variables.getPropertyValue('--action-b'))),
          accent:ratio(variables.getPropertyValue('--brand-ink'),variables.getPropertyValue('--surface')),bg:variables.getPropertyValue('--bg'),brand:variables.getPropertyValue('--brand')};
      })()`);
      metrics.push({theme,color,...measured});
      await check(`${theme}/${color} 说明和主按钮对比度 ≥4.5`,measured.description>=4.5 && measured.primary>=4.5 && measured.accent>=4.5);
      await check(`${theme}/${color} 标题不超过500、说明为400`,Number(measured.titleWeight)<=500 && measured.descriptionWeight==="400");
      await evaluate(cdp,"document.querySelector('.sheet-body').scrollTop=0");await sleep(80);await shot(`${color}-${theme}-settings`);
      await evaluate(cdp,"OTP.ui.closeSheet();OTP.store.patchSettings({view:'grid'});OTP.app.renderAll({stagger:false})");
      await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:10,y:10});await sleep(480);await shot(`${color}-${theme}-page`);
      if(color==='mono')await check(`${theme}/黑白头像不残留彩色`,await evaluate(cdp,"[...document.querySelectorAll('.avatar')].every(n=>!n.style.getPropertyValue('--av-a') && getComputedStyle(n).getPropertyValue('--avatar-text').trim()===(document.documentElement.dataset.theme==='dark'?'#f0f0f3':'#28282c'))"));
      await evaluate(cdp,"OTP.sheets.openManage('settings')");await sleep(460);
    }
  }
  await check("五种色系的强调色各不相同",new Set(metrics.filter(m=>m.theme==="light").map(m=>m.brand)).size===5);
  await click('[data-color-choice="green"]');
  await cdp.send("Input.dispatchKeyEvent",{type:"keyDown",key:"ArrowRight"});await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key:"ArrowRight"});await sleep(650);
  await check("方向键选择下一个色系",await evaluate(cdp,"OTP.store.settings().colorScheme==='blue' && document.activeElement.dataset.colorChoice==='blue'"));
  await evaluate(cdp,"OTP.store.persist()");await goto(cdp,url+"/index.html?reload");
  await check("重载锁屏保留深色和蓝色",await evaluate(cdp,"document.documentElement.dataset.theme==='dark' && document.documentElement.dataset.colorScheme==='blue'"));
  await check("首次样式启动镜像了色系",await evaluate(cdp,"localStorage.getItem('localotp:color-scheme')==='blue'"));
  await setViewport(cdp,402,600,1);await goto(cdp,url+"/popup.html");await unlock();await evaluate(cdp,"OTP.sheets.openManage('settings')");await sleep(450);
  await check("弹窗使用同一保存色系",await evaluate(cdp,"document.documentElement.dataset.colorScheme==='blue' && document.querySelector('[data-color-choice=blue]').getAttribute('aria-checked')==='true'"));
  await check("弹窗五个选项都在边界内",await evaluate(cdp,"[...document.querySelectorAll('.color-choice')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})"));
  await shot("popup-blue-dark");
  await click('.settings-pane .seg-btn[data-id="auto"]');
  await cdp.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"light"}]});await sleep(400);
  await check("跟随系统改变明暗但保留色系",await evaluate(cdp,"document.documentElement.dataset.theme==='light' && document.documentElement.dataset.colorScheme==='blue'"));
  await evaluate(cdp,"OTP.store.patchSettings({colorScheme:'unknown'});OTP.app.applyTheme(false)");
  await check("无效色系回退默认天空蓝",await evaluate(cdp,"OTP.store.settings().colorScheme==='blue' && document.documentElement.dataset.colorScheme==='blue'"));
  await evaluate(cdp,"for(const id of ['green','pink','blue','mono','green'])document.querySelector('[data-color-choice='+id+']').click()");await sleep(350);
  await check("连续快速选择以最后一次为准",await evaluate(cdp,"OTP.store.settings().colorScheme==='green' && document.documentElement.dataset.colorScheme==='green' && document.querySelector('[aria-checked=true][data-color-choice]').dataset.colorChoice==='green'"));
  writeFileSync(resolve(output,"contrast.json"),JSON.stringify(metrics,null,2));
  assert.deepEqual(errors,[]);console.log(`配色检查 ${count} 项通过，无页面异常`);
}catch(error){await shot("test-error");throw error;}finally{cdp.close();browser.kill();server.close();}
