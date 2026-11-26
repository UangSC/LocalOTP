/* 主题头像：真实渲染、现有节点换色、三档渐变对比度及列表/弹窗一致性。 */
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {CDP,evaluate,findBrowser,goto,launchBrowser,setViewport,sleep,startServer} from "./cdp.mjs";
const {server,port}=await startServer(process.cwd());
const {process:browser,target}=await launchBrowser(findBrowser(),9381);
const cdp=await CDP.connect(target.webSocketDebuggerUrl);
const output=resolve("artifacts/avatars");mkdirSync(output,{recursive:true});
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
    for(const color of ["ocean","aurora","sunset"]){
      await evaluate(cdp,`OTP.store.patchSettings({theme:'${theme}',colorScheme:'${color}'});OTP.app.applyTheme(false)`);await sleep(450);
      check(`${color}/${theme} 原有头像节点直接换色`,await evaluate(cdp,"avatarNodes.every((n,i)=>n===document.querySelectorAll('#list .avatar')[i])"));
      check(`${color}/${theme} 已分类账号渲染对应类别 SVG 图标`,await evaluate(cdp,"avatarNodes.every(n=>n.classList.contains('is-cat-icon') && !!n.querySelector('svg'))"));
      await shot(`${color}-${theme}-grid`);
    }
  }
  // 验证平台分类 SVG 头像各自使用官方 Logo 主题色（浅色 & 深色）
  await evaluate(cdp,`(()=>{const acc=OTP.store.accounts();
    OTP.store.updateAccount(acc[1].id,{categoryId:'cat_chatgpt'});
    OTP.store.updateAccount(acc[2].id,{categoryId:'cat_github'});
    OTP.store.updateAccount(acc[3].id,{categoryId:'cat_google'});
    OTP.store.updateAccount(acc[4].id,{categoryId:'cat_microsoft'});
    OTP.store.patchSettings({theme:'light',colorScheme:'ocean',view:'list'});
    OTP.app.applyTheme(false);
    OTP.app.renderAll({stagger:false});
  })()`);await sleep(250);
  check("浅色模式下平台分类头像使用各品牌 Logo 主题色",await evaluate(cdp,`(()=>{
    const gpt=getComputedStyle(document.querySelector('.avatar[data-avatar-icon="brand-chatgpt"] svg')).color;
    const gh=getComputedStyle(document.querySelector('.avatar[data-avatar-icon="brand-github"] svg')).color;
    const dev=getComputedStyle(document.querySelector('.avatar.is-cat-icon:not([data-avatar-icon^="brand-"]) svg')).color;
    const gPaths=[...document.querySelectorAll('.avatar[data-avatar-icon="brand-google"] svg path')];
    const mPaths=[...document.querySelectorAll('.avatar[data-avatar-icon="brand-microsoft"] svg path')];
    return gpt==='rgb(16, 163, 127)' && gh==='rgb(24, 23, 23)' && gpt!==gh && gpt!==dev
      && gPaths.length===4 && new Set(gPaths.map(p=>getComputedStyle(p).fill)).size===4
      && mPaths.length===4 && new Set(mPaths.map(p=>getComputedStyle(p).fill)).size===4;
  })()`));
  await evaluate(cdp,"OTP.store.patchSettings({theme:'dark',colorScheme:'midnight'});OTP.app.applyTheme(false)");await sleep(250);
  check("深色模式下平台分类头像切换为高对比品牌主题色",await evaluate(cdp,`(()=>{
    const gpt=getComputedStyle(document.querySelector('.avatar[data-avatar-icon="brand-chatgpt"] svg')).color;
    const gh=getComputedStyle(document.querySelector('.avatar[data-avatar-icon="brand-github"] svg')).color;
    return gpt==='rgb(45, 212, 168)' && gh==='rgb(240, 246, 252)' && gpt!==gh;
  })()`));
  await evaluate(cdp,"OTP.store.patchSettings({theme:'light',colorScheme:'ocean'});OTP.app.applyTheme(false)");await sleep(200);
  await evaluate(cdp,"OTP.store.updateAccount(OTP.store.accounts()[0].id,{categoryId:''});OTP.app.renderAll({stagger:false})");await sleep(250);
  check("未分类账号使用字母头像",await evaluate(cdp,"(()=>{const a=document.querySelector('#list .avatar');return !a.classList.contains('is-cat-icon') && /^[A-Z]{1,2}$/.test(a.textContent) && !a.querySelector('svg');})()"));
  await evaluate(cdp,"OTP.store.patchSettings({theme:'light',colorScheme:'ocean',view:'list'});OTP.app.applyTheme(false);OTP.app.renderAll({stagger:false})");await sleep(250);await shot("ocean-light-list");
  check("列表头像采用相同分类/字母规则",await evaluate(cdp,"[...document.querySelectorAll('.row .avatar')].slice(1).every(n=>n.classList.contains('is-cat-icon') && !!n.querySelector('svg'))"));
  await evaluate(cdp,"OTP.store.persist()");await setViewport(cdp,402,600,1);await goto(cdp,base+"/popup.html");await unlock();await sleep(500);await shot("ocean-light-popup");
  check("重开弹窗保留默认主题与分类头像",await evaluate(cdp,"document.documentElement.dataset.colorScheme==='ocean'&&[...document.querySelectorAll('.quick .avatar')].slice(1).every(n=>n.classList.contains('is-cat-icon') && !!n.querySelector('svg'))"));
  check("控制台没有异常",errors.length===0);
  writeFileSync(resolve(output,"contrast.json"),JSON.stringify(metrics,null,2));
  console.log(`头像检查 ${count} 项通过`);
}finally{cdp.close();browser.kill();server.close();}
