/* 真实浏览器逐帧视觉检查：放慢并暂停同一条 WAAPI 时间线，检查中途几何与收尾。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { CDP, evaluate, findBrowser, goto, launchBrowser, setViewport, sleep, startServer } from "./cdp.mjs";
const { server, port } = await startServer(process.cwd());
const { process: browser, target } = await launchBrowser(findBrowser(), 9376);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const output = resolve("docs/shots/motion-1.3");
mkdirSync(output, { recursive: true });
let checks = 0;
const errors = [];
async function check(name, expr) { assert.ok(await evaluate(cdp, expr), name); checks++; console.log("✓ " + name); }
async function waitFor(expr) {
  for (let n = 0; n < 100; n++) { if (await evaluate(cdp, expr)) return; await sleep(40); }
  throw new Error("等待状态超时：" + expr);
}
async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(output, name + ".png"), Buffer.from(data, "base64"));
}
async function frames(direction) {
  const theme = await evaluate(cdp, "document.documentElement.dataset.theme");
  await evaluate(cdp, "window.__animSpeed=8");
  if (direction === "open") await evaluate(cdp, `document.querySelector('#pw-lock').value='motion-test'; document.querySelector('.lock-form').requestSubmit(); void 0`);
  else await evaluate(cdp, "void OTP.app.lock()");
  await waitFor("!!document.querySelector('.flip-panel') && document.body.dataset.gatePhase === 'moving'");
  const duration = await evaluate(cdp, `(() => {
    window.motionSet=document.getAnimations().filter(a=>a.effect.target.closest('.lock, #app, .flip-panel'));
    motionSet.forEach(a=>a.pause());
    return document.querySelector('.flip-panel').getAnimations()[0].effect.getTiming().duration;
  })()`);
  const widths = [];
  for (const fraction of [0, .25, .5, .75, .98]) {
    await evaluate(cdp, `motionSet.forEach(a=>a.currentTime=${duration*fraction}); void 0`);
    await sleep(50);
    widths.push(await evaluate(cdp, "document.querySelector('.flip-panel').getBoundingClientRect().width"));
    await shot(`${direction}-${theme}-${Math.round(fraction*100)}`);
    await check(`${direction} ${fraction} 面板未提前淡出`, `getComputedStyle(document.querySelector('.flip-panel')).opacity === '1'`);
  }
  assert.ok(direction === "open" ? widths.every((v,i)=>i===0 || v >= widths[i-1]) : widths.every((v,i)=>i===0 || v <= widths[i-1]));
  checks++; console.log("✓ " + direction + " 面板尺寸沿同一方向连续变化 " + widths.map(Math.round).join(" → "));
  await evaluate(cdp, `motionSet.forEach(a=>{a.currentTime=${duration+1000};a.play()}); window.__animSpeed=1; void 0`);
  await waitFor("!document.querySelector('.flip-panel')");
  if (direction === "close") {
    const samples = await evaluate(cdp, `(async()=>{
      const result=[];
      for(let i=0;i<24;i++) { await new Promise(requestAnimationFrame); const n=document.querySelector('.lock-card'); const r=n.getBoundingClientRect(); result.push({opacity:Number(getComputedStyle(n).opacity),x:r.x,y:r.y,w:r.width,h:r.height,animation:getComputedStyle(n).animationName}); }
      return result;
    })()`);
    assert.ok(samples.every(v => v.opacity === 1 && v.animation === "none"));
    assert.ok(samples.every(v=>Math.abs(v.y-samples[0].y)<.2 && Math.abs(v.w-samples[0].w)<.2));
    checks++; console.log("✓ 锁屏收尾 24 帧透明度与几何稳定，不重播登录卡动画");
  }
}
try {
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", p=>errors.push(p.exceptionDetails.text));
  await setViewport(cdp, 1440, 900, 1);
  const url=`http://127.0.0.1:${port}/index.html`;
  await goto(cdp,url); await evaluate(cdp,"OTP.store.setPassword('motion-test')"); await goto(cdp,url+"?review");
  await frames("open"); await sleep(200); await shot("list-light");
  await check("所有头像只使用字母", `[...document.querySelectorAll('#list .avatar')].every(n=>/^[A-Z]{1,2}$/.test(n.textContent) && !n.querySelector('svg'))`);
  await evaluate(cdp, `document.querySelector('.sw-ico[data-id="grid"]').click()`);
  await check("切换产生逐项空间动画", `document.querySelectorAll('#list [data-motion="active"]').length>2`);
  await sleep(90); await shot("layout-transition");
  await sleep(850); await shot("grid-light");
  await frames("close"); await shot("lock-settled");
  await evaluate(cdp, `OTP.store.patchSettings({theme:'dark'}); OTP.app.applyTheme(false)`);
  await frames("open"); await sleep(150); await shot("grid-dark");
  await check("动效结束后快照已清理", `!document.querySelector('.layout-ghost,.flip-panel')`);
  await evaluate(cdp, "window.__animSpeed=4; void OTP.app.lock()");
  await waitFor("document.body.dataset.gatePhase === 'moving'");
  await setViewport(cdp, 1100, 760, 1);
  await waitFor("!document.querySelector('.flip-panel')");
  await check("收缩途中改变窗口尺寸会安全收尾", `!document.querySelector('.lock').inert && getComputedStyle(document.querySelector('.lock-card')).opacity==='1'`);
  await evaluate(cdp, `window.__animSpeed=4; document.querySelector('#pw-lock').value='motion-test'; document.querySelector('.lock-form').requestSubmit(); void 0`);
  await waitFor("document.body.dataset.gatePhase === 'preparing'");
  await setViewport(cdp, 1280, 820, 1);
  await waitFor("!document.querySelector('.lock')");
  await check("准备期间改变窗口尺寸没有残留层", `!document.querySelector('.flip-panel,.gate-preparation') && !document.querySelector('#screen').inert`);
  await evaluate(cdp, `window.__animSpeed=1`);
  assert.deepEqual(errors,[]);
  console.log(`动效检查 ${checks} 项通过；逐帧截图 ${output}`);
} finally { cdp.close(); browser.kill(); server.close(); }
