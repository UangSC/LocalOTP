/* 六组双色渐变主题（明暗各 3 组）：真实设置点击、对比度、渐变背景与持久化。 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CDP, evaluate, findBrowser, goto, launchBrowser, setViewport, sleep, startServer } from "./cdp.mjs";

const { server, port } = await startServer(process.cwd());
const { process: browser, target } = await launchBrowser(findBrowser(), 9379);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const output = resolve("artifacts/colors");
mkdirSync(output, { recursive: true });
let count = 0;
const errors = [];
const metrics = [];

const THEMES = [
  { id: "ocean", mode: "light" },
  { id: "aurora", mode: "light" },
  { id: "sunset", mode: "light" },
  { id: "midnight", mode: "dark" },
  { id: "nebula", mode: "dark" },
  { id: "ember", mode: "dark" },
];

async function check(name, condition) {
  assert.ok(condition, name);
  count++;
  console.log("✓ " + name);
}

async function click(selector) {
  const point = await evaluate(cdp, `(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',behavior:'instant'});const r=n.getBoundingClientRect();const p={x:r.left+r.width/2,y:r.top+r.height/2};if(!n.contains(document.elementFromPoint(p.x,p.y)))throw new Error('目标被遮挡：'+n.className+' ← '+document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,180));return p})()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
  await sleep(420);
}

async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(output, name + ".png"), Buffer.from(data, "base64"));
}

async function unlock() {
  await evaluate(cdp, "document.querySelector('#pw-lock').value='color-test';document.querySelector('.lock-form').requestSubmit();void 0");
  for (let i = 0; i < 100; i++) {
    if (await evaluate(cdp, "!document.querySelector('.lock')")) return;
    await sleep(40);
  }
  throw new Error("解锁超时");
}

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", p => errors.push(p.exceptionDetails.text));
  await setViewport(cdp, 1440, 900, 1);
  const url = `http://127.0.0.1:${port}`;
  await goto(cdp, url + "/index.html");
  await evaluate(cdp, "OTP.store.setPassword('color-test')");
  await goto(cdp, url + "/index.html?test");
  await unlock();
  await evaluate(cdp, "OTP.sheets.openManage('settings')");
  await sleep(500);

  await check("主题下方有明暗各 3 组共 6 套双色渐变主题", await evaluate(cdp,
    "document.querySelectorAll('.color-choice').length===6 && document.querySelectorAll('.color-choice[data-color-mode=light]').length===3 && document.querySelectorAll('.color-choice[data-color-mode=dark]').length===3"));

  for (const { id, mode } of THEMES) {
    await click(`[data-color-choice="${id}"]`);
    await check(`${mode}/${id} 点击同时更新明暗与双色渐变主题`, await evaluate(cdp,
      `document.documentElement.dataset.colorScheme==='${id}' && document.documentElement.dataset.theme==='${mode}' && OTP.store.settings().colorScheme==='${id}' && OTP.store.settings().theme==='${mode}'`));
    await check(`${mode}/${id} 单选与键盘焦点一致`, await evaluate(cdp,
      `document.querySelectorAll('.color-choice[aria-checked="true"]').length===1 && document.querySelector('[data-color-choice="${id}"]').tabIndex===0`));

    const measured = await evaluate(cdp, `(()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
      const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255)};
      const lum=color=>rgb(color).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const pane=document.querySelector('.settings-pane');const title=pane.querySelector('.set-label b > span');const desc=pane.querySelector('.set-label > span');
      const surface=getComputedStyle(pane.querySelector('.set-card')).backgroundColor;
      const variables=getComputedStyle(document.body);
      const actionA=variables.getPropertyValue('--action-a').trim();
      const actionB=variables.getPropertyValue('--action-b').trim();
      const mainBg=getComputedStyle(document.querySelector('.main')).backgroundImage;
      const btnBg=getComputedStyle(document.querySelector('#page-add')).backgroundImage;
      return {
        title:ratio(getComputedStyle(title).color,surface),
        description:ratio(getComputedStyle(desc).color,surface),
        titleWeight:getComputedStyle(title).fontWeight,
        descriptionWeight:getComputedStyle(desc).fontWeight,
        primary:Math.min(ratio(variables.getPropertyValue('--on-brand'),actionA),ratio(variables.getPropertyValue('--on-brand'),actionB)),
        accent:ratio(variables.getPropertyValue('--brand-ink'),variables.getPropertyValue('--surface')),
        distinctGradient:actionA!==actionB && btnBg.includes('gradient') && mainBg.includes('gradient'),
        brand:variables.getPropertyValue('--brand').trim()
      };
    })()`);
    metrics.push({ mode, id, ...measured });
    await check(`${mode}/${id} 双色渐变按钮与管理页背景生效`, measured.distinctGradient);
    await check(`${mode}/${id} 说明、强调与主按钮双色端点对比度 ≥4.5`, measured.description >= 4.5 && measured.primary >= 4.5 && measured.accent >= 4.5);
    await check(`${mode}/${id} 标题不超过500、说明为400`, Number(measured.titleWeight) <= 500 && measured.descriptionWeight === "400");

    await evaluate(cdp, "document.querySelector('.sheet-body').scrollTop=0");
    await sleep(80);
    await shot(`${id}-${mode}-settings`);
    await evaluate(cdp, "OTP.ui.closeSheet();OTP.store.patchSettings({view:'grid'});OTP.app.renderAll({stagger:false})");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10 });
    await sleep(420);
    await shot(`${id}-${mode}-grid`);
    await evaluate(cdp, "OTP.store.patchSettings({view:'list'});OTP.app.renderAll({stagger:false})");
    await sleep(320);
    await shot(`${id}-${mode}-list`);
    await evaluate(cdp, "OTP.sheets.openManage('settings')");
    await sleep(420);
  }

  await check("六套渐变主题的强调色各不相同", new Set(metrics.map(m => m.brand)).size === 6);

  // 验证方向键切换与持久化
  await click('[data-color-choice="ocean"]');
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight" });
  await sleep(420);
  await check("方向键选择下一个渐变主题", await evaluate(cdp, "OTP.store.settings().colorScheme==='aurora' && document.activeElement.dataset.colorChoice==='aurora'"));

  await click('[data-color-choice="nebula"]');
  await evaluate(cdp, "OTP.store.persist()");
  await goto(cdp, url + "/index.html?reload");
  await check("重载锁屏保留深色与星云暮紫", await evaluate(cdp, "document.documentElement.dataset.theme==='dark' && document.documentElement.dataset.colorScheme==='nebula'"));
  await check("首次样式启动镜像了色系", await evaluate(cdp, "localStorage.getItem('localotp:color-scheme')==='nebula'"));

  await setViewport(cdp, 402, 600, 1);
  await goto(cdp, url + "/popup.html");
  await unlock();
  await evaluate(cdp, "OTP.sheets.openManage('settings')");
  await sleep(420);
  await check("弹窗使用同一保存色系", await evaluate(cdp, "document.documentElement.dataset.colorScheme==='nebula' && document.querySelector('[data-color-choice=nebula]').getAttribute('aria-checked')==='true'"));
  await check("弹窗六个渐变主题卡片都在边界内", await evaluate(cdp, "[...document.querySelectorAll('.color-choice')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})"));
  await shot("popup-nebula-settings");

  await click('.settings-pane .seg-btn[data-id="auto"]');
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await sleep(380);
  await check("跟随系统改变明暗并自动配对渐变", await evaluate(cdp, "document.documentElement.dataset.theme==='light'"));

  await evaluate(cdp, "OTP.store.patchSettings({colorScheme:'unknown'});OTP.app.applyTheme(false)");
  await check("无效色系回退默认晨曦蓝青", await evaluate(cdp, "OTP.store.settings().colorScheme==='ocean' && document.documentElement.dataset.colorScheme==='ocean'"));

  writeFileSync(resolve(output, "contrast.json"), JSON.stringify(metrics, null, 2));
  assert.deepEqual(errors, []);
  console.log(`双色渐变配色检查 ${count} 项通过，无页面异常`);
} catch (error) {
  await shot("test-error");
  throw error;
} finally {
  cdp.close();
  browser.kill();
  server.close();
}
