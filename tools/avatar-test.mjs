/* 主题头像：真实渲染、现有节点换色、三档渐变对比度及列表/弹窗一致性。 */
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {CDP,evaluate,findBrowser,goto,launchBrowser,setViewport,sleep,startServer} from "./cdp.mjs";
const {server,port}=await startServer(process.cwd());
const {process:browser,target}=await launchBrowser(findBrowser(),9381);
const cdp=await CDP.connect(target.webSocketDebuggerUrl);
const output=resolve("docs/shots/avatars");mkdirSync(output,{recursive:true});
const metrics=[],errors=[];let count=0;
function check(name,value){assert.ok(value,name);count++;console.log("✓ "+name);}
async function shot(name){const {data}=await cdp.send("Page.captureScreenshot",{format:"png"});writeFileSync(resolve(output,name+".png"),Buffer.from(data,"base64"));}
async function unlock(){
  await evaluate(cdp,"document.querySelector('#pw-lock').value='avatar-test';document.querySelector('.lock-form').requestSubmit();void 0");
  for(let i=0;i<90;i++){if(await evaluate(cdp,"!document.querySelector('.lock')"))return;await sleep(40);}
  throw new Error("解锁超时");
}
try{
  await cdp.send("Page.enable");await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown",p=>errors.push(p.exceptionDetails.text));
  await setViewport(cdp,1440,900,1);
  const base=`http://127.0.0.1:${port}`;
  await goto(cdp,base+"/index.html");await evaluate(cdp,"OTP.store.setPassword('avatar-test')");
  await goto(cdp,base+"/index.html?test");await unlock();
  await evaluate(cdp,"OTP.store.patchSettings({view:'grid'});OTP.app.renderAll({stagger:false});window.avatarNodes=[...document.querySelectorAll('#list .avatar')]");
  for(const theme of ["light","dark"]){
    for(const color of ["purple","green","blue","pink","mono"]){
      await evaluate(cdp,`OTP.store.patchSettings({theme:'${theme}',colorScheme:'${color}'});OTP.app.applyTheme(false)`);await sleep(450);
      check(`${color}/${theme} 原有头像节点直接换色`,await evaluate(cdp,"avatarNodes.every((n,i)=>n===document.querySelectorAll('#list .avatar')[i])"));
      check(`${color}/${theme} 只有字母且没有固定行内色值`,await evaluate(cdp,"avatarNodes.every(n=>/^[A-Z]{1,2}$/.test(n.textContent)&&!n.querySelector('svg')&&!n.hasAttribute('style'))"));
      const sample=await evaluate(cdp,`(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
        const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
        const contrast=(a,b)=>{a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
        return avatarNodes.map(n=>{
          const style=getComputedStyle(n),probe=document.createElement('span');n.append(probe);
          probe.style.color='var(--avatar-fill-start)';const top=rgb(getComputedStyle(probe).color);
          probe.style.color='var(--avatar-fill-end)';const bottom=rgb(getComputedStyle(probe).color);probe.remove();
          const ink=rgb(style.color);let minimum=100;
          for(let i=0;i<=20;i++){const mix=top.map((v,j)=>v+(bottom[j]-v)*i/20);minimum=Math.min(minimum,contrast(ink,mix));}
          return {letters:n.textContent,tone:n.dataset.avatarTone,top,bottom,ink,minimum,bg:style.backgroundImage};
        });
      })()`);
      metrics.push({theme,color,avatars:sample});
      if(process.argv.includes("--details"))console.log(JSON.stringify(sample));
      check(`${color}/${theme} 三档头像渐变文字对比度 ≥4.5`,new Set(sample.map(x=>x.tone)).size===3 && sample.every(x=>x.minimum>=4.5));
      check(`${color}/${theme} 同色系保留轻微明度层次`,new Set(sample.map(x=>x.bg)).size===3);
      if(color==='mono')check(`${theme} 黑白头像保持中性色`,sample.every(x=>[x.top,x.bottom,x.ink].every(rgb=>Math.max(...rgb)-Math.min(...rgb)<=4)));
      await shot(`${color}-${theme}-grid`);
    }
  }
  for(const theme of ["light","dark"]){
    check(`${theme} 同一服务在五个色系下颜色均不同`,new Set(metrics.filter(m=>m.theme===theme).map(m=>m.avatars[0].bg)).size===5);
  }
  for(const color of ["purple","green","blue","pink","mono"]){
    check(`${color} 浅深色字色与背景分别适配`,metrics.find(m=>m.color===color&&m.theme==='light').avatars[0].bg!==metrics.find(m=>m.color===color&&m.theme==='dark').avatars[0].bg);
  }
  await evaluate(cdp,"OTP.store.patchSettings({theme:'light',colorScheme:'green',view:'list'});OTP.app.applyTheme(false);OTP.app.renderAll({stagger:false})");await sleep(250);await shot("green-light-list");
  check("列表头像采用相同档位机制",await evaluate(cdp,"[...document.querySelectorAll('.row .avatar')].every(n=>n.dataset.avatarTone!==undefined&&!n.hasAttribute('style'))"));
  await evaluate(cdp,"OTP.store.persist()");await setViewport(cdp,402,600,1);await goto(cdp,base+"/popup.html");await unlock();await sleep(500);await shot("green-light-popup");
  check("重开弹窗保留绿色字母头像",await evaluate(cdp,"document.documentElement.dataset.colorScheme==='green'&&[...document.querySelectorAll('.quick .avatar')].every(n=>n.dataset.avatarTone!==undefined&&!n.hasAttribute('style'))"));
  check("控制台没有异常",errors.length===0);
  writeFileSync(resolve(output,"contrast.json"),JSON.stringify(metrics,null,2));
  console.log(`头像检查 ${count} 项通过，最低对比度 ${Math.min(...metrics.flatMap(m=>m.avatars.map(a=>a.minimum))).toFixed(2)}:1`);
}finally{cdp.close();browser.kill();server.close();}
