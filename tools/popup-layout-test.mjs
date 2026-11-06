/* 小窗设置、文档边界及缩放后的分段滑块实际布局回归。 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CDP, evaluate, findBrowser, launchBrowser, startServer, setViewport, goto, sleep } from './cdp.mjs';
const { server, port } = await startServer(process.cwd());
const { process: browser, target } = await launchBrowser(findBrowser(), 0, { gpu: true });
const page = await CDP.connect(target.webSocketDebuggerUrl);
const shots = resolve('artifacts/popup-layout');
mkdirSync(shots, { recursive: true });
const ev = expression => evaluate(page, expression);
const errors = [], report = [];
const shot = async name => {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(shots, name + '.png'), Buffer.from(data, 'base64'));
};
async function layout(label) {
  const result = await ev(`(()=>{
    const root=document.documentElement, body=document.body, sheet=document.querySelector('.sheet');
    const rect=n=>n.getBoundingClientRect();
    const fits=(n,parent)=>{const a=rect(n),b=rect(parent);return a.left>=b.left-1 && a.right<=b.right+1};
    const rows=[...document.querySelectorAll('.settings-pane .set-row')];
    const segments=[...document.querySelectorAll('.sheet .seg')].filter(n=>n.offsetWidth);
    return {
      documentFits:getComputedStyle(root).overflow==='hidden' && scrollX===0 && scrollY===0,
      sheetFits:rect(sheet).top>=0 && rect(sheet).bottom<=innerHeight && rect(sheet).left>=0 && rect(sheet).right<=innerWidth,
      cardsFit:[...document.querySelectorAll('.settings-pane .set-card')].every(n=>fits(n,sheet)&&n.scrollWidth<=n.clientWidth),
      controlsFit:rows.every(n=>fits(n.querySelector('.set-ctl'),n)),
      labelsReadable:rows.every(n=>rect(n.querySelector('.set-label')).width>=100),
      slidersFit:segments.every(n=>{const p=n.querySelector('.seg-pill'),b=n.querySelector('.seg-btn.is-on');return fits(p,n)&&Math.abs(rect(p).left-rect(b).left)<=1&&Math.abs(rect(p).width-rect(b).width)<=1}),
      scrollable:document.querySelector('.sheet-body').scrollHeight>document.querySelector('.sheet-body').clientHeight
    };
  })()`);
  report.push({ label, ...result });
  for (const [key, value] of Object.entries(result)) assert.ok(value, `${label}: ${key}`);
  console.log('✓ ' + label + '：文档、卡片、控件、滑块边界和内部滚动通过');
}
try {
  await page.send('Runtime.enable');
  page.on('Runtime.exceptionThrown', e=>errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await setViewport(page, 402, 600, 1);
  await goto(page, `http://127.0.0.1:${port}/popup.html`);
  await ev("OTP.store.setPassword('layout-test')");
  for (const path of ['popup.html', 'popup.html?floating=1', 'popup.html?floating=pip', 'index.html']) {
    await goto(page, `http://127.0.0.1:${port}/${path}`);
    await ev("document.querySelector('#pw-lock').value='layout-test';document.querySelector('.lock-form').requestSubmit()");
    await sleep(400);
    await ev('OTP.sheets.openSettings()');
    for (const [width,height] of [[640,720],[430,680],[402,600],[360,514],[320,480],[480,600]]) {
      await setViewport(page,width,height,1);
      await sleep(400);
      await layout(`${path} ${width}×${height}`);
    }
    for (const theme of ['light','dark']) {
      await setViewport(page,360,514,1.25);
      await ev(`OTP.store.patchSettings({theme:${JSON.stringify(theme)}});OTP.app.applyTheme(false);document.querySelector('.sheet-body').scrollTop=0`);
      await sleep(400);
      await layout(`${path} ${theme} 125%`);
      if (path==='popup.html') {
        await shot('settings-top-'+theme);
        await ev("document.querySelector('#remember-duration').scrollIntoView({block:'center'});document.querySelector('#remember-duration [data-id=\"5\"]').click()");
        await sleep(400);
        await layout(`切换免密时长 ${theme}`);
        assert.equal(await ev('OTP.store.settings().rememberMinutes'),5);
        await shot('settings-timing-'+theme);
      }
    }
    await ev("document.querySelector('.sheet-tabs [data-id=\"import\"]').click()");
    await setViewport(page,402,600,1);
    await ev("document.querySelector('.sheet-tabs [data-id=\"settings\"]').click()");
    await sleep(400);
    await layout(`${path} 切换设置后重新对齐`);
    await ev("document.querySelector('.sheet-body').scrollTop=10000");
    assert.ok(await ev("document.querySelector('.sheet-body').scrollTop>0 && scrollY===0"),'仅抽屉内容滚动');
  }
  assert.deepEqual(errors,[],'页面没有脚本异常');
  writeFileSync(resolve(shots,'verification.json'),JSON.stringify(report,null,2));
  console.log(report.length+' 组布局回归通过');
} finally {
  await page.send('Browser.close').catch(()=>{});
  page.close(); browser.kill(); server.close();
}
