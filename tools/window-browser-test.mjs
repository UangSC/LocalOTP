/* 真扩展测试：折叠、风险确认、跨页面免密与独立窗口 / Document PiP。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CDP, evaluate, findBrowser, sleep, createBrowserProfile, cleanProfileOnExit, setViewport } from './cdp.mjs';
const output = resolve(process.env.LOCALOTP_SHOTS_DIR || 'artifacts/window-1.6'); mkdirSync(output, { recursive: true });
const profile = createBrowserProfile('window-'), port = 15000+Math.floor(Math.random()*20000);
const browser = spawn(findBrowser(), ['--headless=new', '--edge-skip-compat-layer-relaunch', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${process.cwd()}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
cleanProfileOnExit(browser, profile);
let page, worker, floating, base, count = 0;
const errors = [], details = {};
const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
function check(name, value) { assert.ok(value, name); count++; console.log('✓ ' + name); }
async function until(cdp, expression) { for (let i = 0; i < 150; i++) { try { if (await evaluate(cdp, expression)) return; } catch (_) {} await sleep(40); } throw Error('等待超时：' + expression); }
async function navigate(cdp) { await cdp.send('Page.navigate', { url: base + '/popup.html' }); await sleep(300); await until(cdp, '!!OTP.store?.state.ready && !!document.querySelector("#pin-window-btn svg")'); }
async function click(cdp, selector) {
  const p = await evaluate(cdp, `(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('没有目标');n.scrollIntoView({block:'nearest',behavior:'instant'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await sleep(40);
  check('鼠标可命中 ' + selector, await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${p.x},${p.y}))`));
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
}
async function fill(cdp, selector, value) { await evaluate(cdp, `(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}))})()`); }
async function unlock(cdp) {
  await until(cdp, '!!document.querySelector("#pw-lock") && !document.querySelector(".lock").inert && !document.body.dataset.gateMotion'); await fill(cdp, '#pw-lock', 'window-test');
  await evaluate(cdp, 'document.querySelector(".lock-form").requestSubmit()');
  await until(cdp, '!document.querySelector(".lock") && document.querySelector(".screen").classList.contains("is-in")');
}
async function shot(cdp, name) { await sleep(400); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(output, name + '.png'), Buffer.from(data, 'base64')); }
const lease = () => evaluate(worker, '(async()=>(await chrome.storage.session.get("localotp:access:v1"))["localotp:access:v1"].lease)()');
try {
  let all, sw;
  for (let i = 0; i < 100; i++) { try { all = await targets(); sw = all.find(t => t.url.endsWith('/js/background.js')); if (sw) break; } catch (_) {} await sleep(100); }
  assert.ok(sw, '扩展未加载');
  worker = await CDP.connect(sw.webSocketDebuggerUrl); page = await CDP.connect(all.find(t => t.type === 'page').webSocketDebuggerUrl);
  base = new URL('/', sw.url).href.replace(/\/$/, '');
  await page.send('Runtime.enable'); page.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  await setViewport(page, 402, 600, 1); await navigate(page);
  await evaluate(page, 'OTP.store.setPassword("window-test")'); await evaluate(page, 'OTP.store.resetDemo();OTP.store.persist()');
  await navigate(page); await unlock(page);
  check('新设置默认 15 分钟免密', await evaluate(page, 'OTP.store.settings().rememberMinutes===15'));
  check('临时验证默认是一行，内容不可聚焦', await evaluate(page, 'document.querySelector("#quick-generator").getBoundingClientRect().height<55 && document.querySelector(".otp-fold-grid").inert && document.querySelector(".otp-fold-toggle").getAttribute("aria-expanded")==="false"'));
  details.collapsedHeight = await evaluate(page, 'document.querySelector("#quick-generator").getBoundingClientRect().height');
  await shot(page, 'collapsed');
  await click(page, '.otp-fold-toggle');
  check('展开使用真实高度过渡动画', await evaluate(page, 'document.querySelector(".otp-fold-grid").getAnimations().length>0'));
  await sleep(380); await fill(page, '#quick-otp-input', 'JBSWY3DPEHPK3PXP');
  await until(page, 'document.querySelector("#quick-generator").dataset.otpStatus==="ready"');
  await shot(page, 'expanded'); await click(page, '.otp-fold-toggle'); await sleep(350);
  check('折叠暂停验证码并保留本次输入', await evaluate(page, 'document.querySelector("#quick-generator").dataset.otpStatus==="paused" && !!document.querySelector("#quick-otp-input").value'));
  await click(page, '.otp-fold-toggle'); await until(page, 'document.querySelector("#quick-generator").dataset.otpStatus==="ready"');
  for (let i = 0; i < 6; i++) await evaluate(page, 'document.querySelector(".otp-fold-toggle").click()');
  await sleep(350); check('快速切换后展开状态与可交互状态一致', await evaluate(page, 'document.querySelector(".otp-fold-toggle").getAttribute("aria-expanded")==="true" && !document.querySelector(".otp-fold-grid").inert'));
  await click(page, '#settings-btn'); await sleep(450);
  const syncBeforeInspect=await evaluate(worker,'chrome.storage.sync.get(null).then(JSON.stringify)');
  await click(page,'#sync-inspect');await until(page,'!document.querySelector("#sync-diagnostics").hidden');
  check('真实只读诊断显示本机与同步缓存条数',await evaluate(page,'document.querySelector("#sync-diagnostics").textContent.includes("本机账号 10 条") && document.querySelector("#sync-diagnostics").textContent.includes("同步缓存账号 0 条")'));
  check('空缓存诊断说明运行时版本与浏览器传输检查',await evaluate(page,'document.querySelector("#sync-diagnostics").textContent.includes(chrome.runtime.getManifest().version) && document.querySelector("#sync-diagnostics").textContent.includes("Extension Settings") && !document.querySelector("#sync-diagnostics").textContent.includes("旧数据属于另一个 ID")'));
  check('只读诊断不写入同步存储',await evaluate(worker,'chrome.storage.sync.get(null).then(JSON.stringify)')===syncBeforeInspect);
  await evaluate(page, "document.querySelector('#remember-duration [data-id=\"5\"]').click()");
  await until(page, 'OTP.store.settings().rememberMinutes===5 && OTP.access.graceActive && !document.querySelector(".access-timing").inert');
  const firstLease = await lease(); check('确认后签发 5 分钟浏览器会话租约', firstLease.expires - firstLease.at === 300000);
  await shot(page, 'remember-settings');
  await navigate(page); await until(page, 'document.querySelector(".screen").classList.contains("is-in")');
  check('重开无需密码且临时区重新折叠', await evaluate(page, '!document.querySelector(".lock") && document.querySelector("#quick-generator").dataset.otpOpen==="false"'));
  check('重开不延长授权期限', (await lease()).expires === firstLease.expires);
  await evaluate(page, 'OTP.store.patchSettings({lockAfter:1});window.realNow=Date.now;Date.now=()=>realNow()+61000');
  await sleep(4300);
  check('超过闲置阈值后免密有效期仍暂缓自动锁定', await evaluate(page, '!document.querySelector(".lock") && OTP.access.graceActive'));
  await evaluate(page, 'Date.now=realNow;OTP.store.patchSettings({lockAfter:5})');
  await evaluate(worker, '(async()=>{const key="localotp:access:v1";const state=(await chrome.storage.session.get(key))[key];state.lease.expires=Date.now()-1;await chrome.storage.session.set({[key]:state})})()');
  await navigate(page); await until(page, '!!document.querySelector(".lock")');
  check('到期重开必须验证密码', await evaluate(page, 'document.querySelector("#screen").inert'));
  await unlock(page); await click(page, '#lock-btn'); await until(page, '!!document.querySelector(".lock") && !document.body.dataset.gateMotion');
  check('手动锁定清除后台租约', (await lease()) === null);
  await navigate(page); await until(page, '!!document.querySelector(".lock")'); await unlock(page);
  await click(page, '#settings-btn'); await sleep(400); await evaluate(page, "document.querySelector('#remember-duration [data-id=\"0\"]').click()");
  await until(page, 'OTP.store.settings().rememberMinutes===0');
  await evaluate(page, 'OTP.ui.closeAll()'); await sleep(420);
  await click(page, '#pin-window-btn');
  let target;
  for (let i = 0; i < 100; i++) { target = (await targets()).find(t => t.url.includes('popup.html?floating=1')); if (target) break; await sleep(50); }
  assert.ok(target, '没有打开独立小窗');
  floating = await CDP.connect(target.webSocketDebuggerUrl); await floating.send('Runtime.enable');
  floating.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  await until(floating, '!!globalThis.OTP?.app && document.querySelector(".screen").classList.contains("is-in")');
  check('独立小窗无需再次输入密码，票据从地址栏清除', await evaluate(floating, '!document.querySelector(".lock") && !location.hash'));
  await click(page, '#pin-window-btn'); await sleep(200);
  check('重复固定复用同一独立窗口', (await targets()).filter(t => t.url.includes('popup.html?floating=1')).length === 1);
  await shot(floating, 'floating');
  details.pipSupported = await evaluate(floating, '!!documentPictureInPicture');
  if (details.pipSupported) {
    await click(floating, '#pin-window-btn');
    await until(floating, '!!documentPictureInPicture.window || [...document.querySelectorAll(".toast")].some(n=>n.textContent.includes("未能"))');
    check('真实 Document PiP 已打开', await evaluate(floating, '!!documentPictureInPicture.window'));
    await until(floating, '!!documentPictureInPicture.window.document.querySelector("iframe")?.contentDocument?.querySelector(".screen.is-in")');
    check('画中画加载已授权插件且无需额外密码', await evaluate(floating, '!documentPictureInPicture.window.document.querySelector("iframe").contentDocument.querySelector(".lock")'));
    await evaluate(floating, `(()=>{const frame=documentPictureInPicture.window.document.querySelector('iframe');const d=frame.contentDocument;d.querySelector('.otp-fold-toggle').click();const input=d.querySelector('#quick-otp-input');input.value='JBSWY3DPEHPK3PXP';input.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));})()`);
    await until(floating, 'documentPictureInPicture.window.document.querySelector("iframe").contentDocument.querySelector("#quick-generator").dataset.otpStatus==="ready"');
    check('画中画内的临时验证码实际计算成功', await evaluate(floating, '/^[0-9]{3} [0-9]{3}$/.test(documentPictureInPicture.window.document.querySelector("iframe").contentDocument.querySelector(".otp-value").textContent)'));
    check('置顶时原小窗不可交互', await evaluate(floating, 'document.querySelector("#app").inert && document.body.dataset.pipOwner==="1"'));
    await shot(floating, 'pip-owner');
    await evaluate(floating, 'documentPictureInPicture.window.close()');
    await until(floating, '!document.body.dataset.pipOwner');
    check('取消置顶回到原小窗', await evaluate(floating, '!document.querySelector("#app").inert'));
  }
  await click(floating, '#lock-btn'); await until(floating, '!!document.querySelector(".lock")');
  await until(page, '!!document.querySelector(".lock")');
  check('独立窗锁定同时撤销其他窗口授权', await evaluate(page, 'document.querySelector("#screen").inert'));
  await unlock(floating);
  await evaluate(floating, '(async()=>{OTP.store.patchSettings({rememberMinutes:5});await OTP.store.persist();await OTP.access.remember()})()');
  check('改密前已有有效免密租约', !!(await lease()));
  await evaluate(floating, 'OTP.store.setPassword("rotated-test")');
  await until(floating, '!!document.querySelector(".lock")');
  await until(worker, '(async()=>!(await chrome.storage.session.get("localotp:access:v1"))["localotp:access:v1"].lease)()');
  await navigate(page); await until(page, '!!document.querySelector(".lock")');
  check('实际改密撤销授权且重开仍上锁', await evaluate(page, 'document.querySelector("#screen").inert'));
  check('后台拒绝旧密码并接受新密码', await evaluate(page, '(async()=>!(await OTP.access.unlock("window-test")) && await OTP.access.unlock("rotated-test"))()'));
  check('会话记录没有明文密码', await evaluate(worker, '(async()=>!JSON.stringify(await chrome.storage.session.get(null)).includes("window-test"))()'));
  check('没有页面异常', errors.length === 0);
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ checks: count, errors, ...details }, null, 2));
  console.log(`窗口与免密 ${count} 项通过；${JSON.stringify(details)}`);
} catch (error) {
  if (page) { await shot(page, 'failure').catch(() => {}); console.log(await evaluate(page, 'document.body.innerText').catch(() => '')); }
  if (floating) console.log(await evaluate(floating, 'document.body.innerText').catch(() => ''));
  throw error;
} finally { page?.close(); worker?.close(); floating?.close(); browser.kill(); }
