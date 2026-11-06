/* 弹窗首开尺寸：从窄视口启动并按文档首选尺寸收敛，避免把固定视口当作自动定尺寸验收。 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CDP, evaluate, findBrowser, launchBrowser, goto, setViewport, sleep } from './cdp.mjs';
const { process: browser, target } = await launchBrowser(findBrowser(), 0);
const page = await CDP.connect(target.webSocketDebuggerUrl);
const output = resolve('artifacts/popup-sizing');
mkdirSync(output, { recursive: true });
const ev = expression => evaluate(page, expression);
async function size() {
  return ev(`(()=>{const b=document.body.getBoundingClientRect(),s=document.querySelector('.shell').getBoundingClientRect();return {width:b.width,height:b.height,shellWidth:s.width,shellHeight:s.height}})()`);
}
async function settle() {
  const steps=[];
  for(let i=0;i<3;i++) {
    const preferred=await size();steps.push(preferred);
    await setViewport(page,Math.round(preferred.width),Math.round(preferred.height),1);
  }
  return steps;
}
async function shot(name) {
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});
  writeFileSync(resolve(output,name+'.png'),Buffer.from(data,'base64'));
}
try {
  const url=pathToFileURL(resolve('popup.html')).href;
  await setViewport(page,25,600,1);
  await goto(page,url);
  // 在同一份 HTML 中复现上次错误的尺寸规则，不改产品文件。
  await ev(`(()=>{const style=document.createElement('style');style.id='broken-sizing';style.textContent='body[data-surface="popup"] { width:min(402px,100vw);height:min(680px,100vh); }';document.head.append(style)})()`);
  const broken=await settle();
  assert.equal(broken.at(-1).width,25,'旧规则应复现竖条锁定');
  await shot('before-strip');
  await ev("document.querySelector('#broken-sizing').remove()");
  const restored=await settle();
  assert.equal(restored.at(-1).width,402);
  assert.equal(restored.at(-1).height,600);
  await shot('after-lock');
  const checks=[];
  for(const [width,height] of [[25,600],[25,25],[100,100],[300,450],[402,600]]) {
    await setViewport(page,width,height,1);
    await goto(page,url);
    const steps=await settle(),final=steps.at(-1);
    assert.equal(final.width,402,`${width}×${height} 首开必须恢复正常宽度`);
    assert.equal(final.height,600,`${width}×${height} 首开必须恢复正常高度`);
    checks.push({initial:{width,height},final});
  }
  await ev("OTP.store.setPassword('sizing-test')");
  await goto(page,url);
  await ev("document.querySelector('#pw-lock').value='sizing-test';document.querySelector('.lock-form').requestSubmit()");
  await sleep(450);await shot('after-list');
  await ev('OTP.sheets.openSettings()');await sleep(450);await shot('after-settings');
  assert.ok(await ev("[...document.querySelectorAll('.settings-pane .set-ctl')].every(n=>n.getBoundingClientRect().right<=innerWidth)"));
  writeFileSync(resolve(output,'verification.json'),JSON.stringify({broken,restored,checks},null,2));
  console.log('HTML 已复现旧版 25px 竖条；修复后 5 种首开尺寸均收敛至 402×600，列表与设置可见。');
} finally {
  await page.send('Browser.close').catch(()=>{});page.close();browser.kill();
}
