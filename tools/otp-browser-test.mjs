/* 真正加载 MV3 扩展；鼠标命中、URL 路由、剪贴板、存储隔离与弹窗布局联合验收。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { CDP, evaluate, findBrowser, sleep, createBrowserProfile, cleanProfileOnExit, setViewport } from './cdp.mjs';

const output = resolve('artifacts/studio-1.5'); mkdirSync(output, { recursive: true });
const profile = createBrowserProfile('otp-');
const port = 15000+Math.floor(Math.random()*20000);
const child = spawn(findBrowser(), ['--headless=new', '--edge-skip-compat-layer-relaunch', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${process.cwd()}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
cleanProfileOnExit(child, profile);
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const errors = [], requests = [], metrics = [];
let cdp, worker, base, count = 0, loads = 0;
const check = (name, value) => { assert.ok(value, name); count++; console.log('✓ ' + name); };
const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function wait(expression) {
  for (let i = 0; i < 120; i++) { if (await evaluate(cdp, expression)) return; await sleep(30); }
  throw new Error('条件等待超时：' + expression);
}
async function navigate(method, params) {
  const previous = loads;
  const navigation = await cdp.send(method, params);
  if (method === 'Page.reload' || navigation.loaderId) {
    for (let i = 0; i < 120 && loads === previous; i++) await sleep(30);
    assert.ok(loads > previous, '没有收到新页面加载完成事件');
  } else await sleep(60); // 同文档片段导航触发 hashchange，不产生 load 事件。
  await wait('document.readyState === "complete" && !!globalThis.OTP');
}
async function goto(path) { await navigate('Page.navigate', { url: base + path }); }
async function fill(selector, text) {
  await evaluate(cdp, `(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.value=${JSON.stringify(text)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function click(selector) {
  const point = await evaluate(cdp, `(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('找不到点击目标');n.scrollIntoView({block:'nearest',behavior:'instant'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await sleep(40);
  check('鼠标命中 ' + selector, await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`));
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  await sleep(120);
}
async function key(key, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, modifiers });
  await sleep(60);
}
async function shot(name) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }); await sleep(180);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(output, name + '.png'), Buffer.from(data, 'base64'));
}
function reference(counter, algorithm = 'sha1', digits = 6) {
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac(algorithm, '12345678901234567890').update(bytes).digest();
  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
async function unlock() {
  await wait('!!document.querySelector("#pw-lock")');
  await fill('#pw-lock', 'otp-browser-test'); await evaluate(cdp, 'document.querySelector(".lock-form").requestSubmit()');
  await wait('!document.querySelector(".lock") && !document.body.dataset.gateMotion');
}
try {
  let all;
  for (let i = 0; i < 80; i++) { await sleep(150); try { all = await targets(); if (all.some(t => t.type === 'service_worker' && t.url.endsWith('/js/background.js'))) break; } catch (_) {} }
  const sw = all?.find(t => t.type === 'service_worker' && t.url.endsWith('/js/background.js'));
  assert.ok(sw, '真实扩展加载失败');
  worker = await CDP.connect(sw.webSocketDebuggerUrl);
  cdp = await CDP.connect(all.find(t => t.type === 'page').webSocketDebuggerUrl);
  base = new URL('/', sw.url).href.replace(/\/$/, '');
  // 仅给这个隔离测试配置读剪贴板的权限；产品 manifest 仍只有写权限。
  await cdp.send('Browser.grantPermissions', { origin: base, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable');
  cdp.on('Page.loadEventFired', () => loads++);
  cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  cdp.on('Network.requestWillBeSent', event => requests.push({ url: event.request.url, type: event.type }));
  for (let i = 0; i < 100; i++) { if (await evaluate(worker, '!!globalThis.OTP?.store?.state.ready')) break; await sleep(50); }
  check('MV3 后台完成初始化', await evaluate(worker, '!!globalThis.OTP?.store?.state.ready'));
  check('真实 manifest 注册 otp 关键字', await evaluate(worker, 'chrome.runtime.getManifest().omnibox.keyword === "otp"'));
  check('仅新增主动扫码所需 activeTab，无常驻站点与浏览记录权限', await evaluate(worker, 'JSON.stringify(chrome.runtime.getManifest().permissions) === JSON.stringify(["storage","clipboardWrite","alarms","activeTab","scripting"]) && !chrome.runtime.getManifest().host_permissions'));
  const before = await evaluate(worker, '(async()=>JSON.stringify({local:await chrome.storage.local.get(null),sync:await chrome.storage.sync.get(null)}))()');
  await setViewport(cdp, 1280, 900, 1);
  await goto('/api.html#otp=' + secret); await wait('document.querySelector("#api-generator").dataset.otpStatus === "ready"');
  check('URL 密钥在初始化阶段从当前历史项清除', await evaluate(cdp, '!location.hash && !location.search && !globalThis.localOtpEntry'));
  check('独立页面不载入账号库模块', await evaluate(cdp, '!OTP.store && ![...document.scripts].some(s=>s.src.includes("store.js"))'));
  check('默认掩码且支持输入框手动使用', await evaluate(cdp, 'document.querySelector("#api-otp-input").type === "password"'));
  const verify = await evaluate(cdp, `({code:document.querySelector('.otp-value').textContent.replaceAll(" ",''),counter:Math.floor(Date.now()/30000)})`);
  check('扩展实际验证码等于独立 HMAC 参考实现', verify.code === reference(verify.counter));
  check('每秒更新不会重复触发屏幕阅读器提示', await evaluate(cdp, `new Promise(resolve=>{let changes=0;const observer=new MutationObserver(records=>changes+=records.length);observer.observe(document.querySelector('.otp-hint'),{childList:true,characterData:true,subtree:true});setTimeout(()=>{observer.disconnect();resolve(changes===0)},2200)})`));
  await shot('api-light');
  await click('.otp-copy');
  check('真实剪贴板写入成功', await evaluate(cdp, 'document.querySelector(".otp-hint").textContent.includes("已复制")'));
  const clipboard = await evaluate(cdp, 'navigator.clipboard.readText()');
  check('剪贴板是当前验证码', clipboard === reference(Math.floor(Date.now() / 30000)));
  await click('.otp-advanced summary');
  await click('[aria-label="摘要算法"]');
  await sleep(250);
  check('滚动后菜单不会立即关闭', await evaluate(cdp, '!!document.querySelector(".select-popup")'));
  await evaluate(cdp, 'document.dispatchEvent(new Event("scroll"))');
  check('延迟到达的外层滚动事件只重定位菜单', await evaluate(cdp, '!!document.querySelector(".select-popup") && document.querySelector("[aria-label=摘要算法]").getAttribute("aria-expanded")==="true"'));
  // 原生鼠标点选，不用 .click() 绕过遮挡或滚动问题。
  await click('.select-option:nth-child(2)');
  check('参数菜单实际切到 SHA-256', await evaluate(cdp, 'document.querySelector(".otp-meta").textContent.startsWith("SHA-256")'));
  await click('[aria-label="验证码位数"]'); await key('ArrowDown'); await key('Enter');
  check('键盘将验证码切换为 8 位', await evaluate(cdp, 'document.querySelector(".otp-value").textContent.replaceAll(" ","").length === 8'));
  await fill('[aria-label="周期（秒）"]', '45'); await wait('document.querySelector(".otp-meta").textContent.includes("45 秒")');
  const custom = await evaluate(cdp, `({code:document.querySelector('.otp-value').textContent.replaceAll(" ",''),counter:Math.floor(Date.now()/45000)})`);
  check('自定义周期真实参与算法', custom.code === reference(custom.counter, 'sha256', 8));
  await fill('#api-otp-input', 'invalid!');
  check('非法输入立即清除旧码并禁用复制', await evaluate(cdp, 'document.querySelector(".otp-copy").disabled && document.querySelector("#api-generator").dataset.otpStatus === "error" && !/[0-9]/.test(document.querySelector(".otp-value").textContent)'));
  await fill('#api-otp-input', `otpauth://totp/Test?secret=${secret}&algorithm=SHA512&digits=8&period=60`);
  await wait('document.querySelector("#api-generator").dataset.otpStatus === "ready"');
  check('otpauth 使用自身参数', await evaluate(cdp, 'document.querySelector(".otp-meta").textContent === "SHA-512 · 8 位 · 60 秒"'));
  check('otpauth 参数控件显示真实值并禁用手动覆盖', await evaluate(cdp, `document.querySelector('[aria-label="摘要算法"]').value === 'SHA512' && document.querySelector('[aria-label="摘要算法"]').disabled && document.querySelector('[aria-label="周期（秒）"]').value === '60'`));
  await click('#api-theme'); await shot('api-dark-advanced');
  await fill('#api-otp-input', secret);
  await setViewport(cdp, 1280, 720, 1);
  await evaluate(cdp, 'window.scrollTo(0,140)'); await sleep(80);
  await click('[aria-label="摘要算法"]');
  await click('.select-option:nth-child(1)');
  check('720px 高页面滚动后仍可点选算法', await evaluate(cdp, 'document.querySelector(".otp-meta").textContent.startsWith("SHA-1")'));
  for (const width of [320, 402, 768]) {
    await setViewport(cdp, width, 760, 1);
    check(width + 'px 无横向溢出且按钮可见', await evaluate(cdp, `document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.otp-input-wrap,.otp-copy,.otp-options')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})`));
    if (width === 320) await shot('api-mobile');
  }
  const after = await evaluate(worker, '(async()=>JSON.stringify({local:await chrome.storage.local.get(null),sync:await chrome.storage.sync.get(null)}))()');
  check('输入与复制均未修改扩展本地或同步存储', before === after);
  check('页面 localStorage / sessionStorage 未写入密钥', await evaluate(cdp, `![JSON.stringify(localStorage),JSON.stringify(sessionStorage)].some(x=>x.includes(${JSON.stringify(secret)}))`));
  check('未请求任何外部验证码服务或外部资源', requests.every(r => r.url.startsWith(base) || r.url.startsWith('data:')));
  check('密钥未出现在子资源请求中', requests.filter(r => r.type !== 'Document').every(r => !r.url.includes(secret)));
  await navigate('Page.reload'); await wait('!!document.querySelector("#api-otp-input")');
  check('重新加载后临时密钥与验证码清空', await evaluate(cdp, '!document.querySelector("#api-otp-input").value && document.querySelector(".otp-copy").disabled'));
  await goto('/api.html?secret=' + secret + '&algorithm=SHA256&digits=8&period=45'); await wait('document.querySelector("#api-generator").dataset.otpStatus === "ready"');
  check('查询参数入口兼容且地址被清理', await evaluate(cdp, '!location.search && document.querySelector(".otp-meta").textContent === "SHA-256 · 8 位 · 45 秒"'));
  await goto('/api.html#otp=' + secret + '&otp=AAAA');
  check('歧义参数不计算', await evaluate(cdp, 'document.querySelector("#api-generator").dataset.otpStatus === "error" && document.querySelector(".otp-copy").disabled'));

  // 与已保存账号库共同运行，防止新功能破坏锁屏、搜索或列表高度。
  await setViewport(cdp, 402, 600, 1); await goto('/popup.html');
  await wait('!!OTP.store?.state.ready && !!document.querySelector(".lock")');
  await evaluate(cdp, 'OTP.store.setPassword("otp-browser-test")');
  await evaluate(cdp, 'OTP.store.resetDemo(); OTP.store.persist()');
  await cdp.send('Emulation.setNavigatorOverrides', { platform: 'MacIntel' });
  await goto('/popup.html'); await unlock();
  check('macOS 快捷键提示为 Command', await evaluate(cdp, '[...document.querySelectorAll("kbd")].some(n=>n.textContent==="⌘ K")'));
  await click('.otp-fold-toggle');
  await fill('#quick-otp-input', secret); await wait('document.querySelector("#quick-generator").dataset.otpStatus === "ready"');
  const size = await evaluate(cdp, `(()=>{const v=document.querySelector('#viewport').getBoundingClientRect(),g=document.querySelector('#quick-generator').getBoundingClientRect(),d=document.querySelector('.dock').getBoundingClientRect();return {viewportHeight:v.height,widgetHeight:g.height,dockBottom:d.bottom,scrollWidth:document.documentElement.scrollWidth};})()`);
  metrics.push({ popup: size });
  check('402×600 弹窗保留至少 190px 账号滚动区', size.viewportHeight >= 190 && size.dockBottom <= 600 && size.scrollWidth <= 402);
  check('账号行不被 flex 压扁，复制操作完整留在卡片内', await evaluate(cdp, `[...document.querySelectorAll('.quick')].every(n=>{const r=n.getBoundingClientRect(),a=n.querySelector('.q-acts').getBoundingClientRect();return r.height>=75&&a.bottom<=r.bottom&&a.top>=r.top})`));
  await click('.quick:last-child .qact-code');
  // 浏览器剪贴板是异步操作，不能假定固定 120ms 内已经返回成功。
  await wait('document.querySelector(".quick:last-child .qact-code").classList.contains("is-done")');
  check('滚动到底部仍能复制最后一条账号', await evaluate(cdp, 'document.querySelector(".quick:last-child .qact-code").classList.contains("is-done")'));
  await evaluate(cdp, 'OTP.ui.closeAll();document.querySelector("#list").scrollTo({top:0,behavior:"instant"})');
  await wait('document.querySelector("#list").scrollTop===0');
  await shot('popup-light');
  await key('k', 4); // CDP Meta modifier。
  check('Command K 在 macOS 模式聚焦搜索', await evaluate(cdp, 'document.activeElement.id === "search-input"'));
  await fill('#search-input', 'demo source');
  check('临时计算不会污染账号搜索', await evaluate(cdp, 'document.querySelector("#quick-generator").dataset.otpStatus === "ready" && OTP.store.stats().count === 10'));
  await fill('#search-input', ''); await click('#lock-btn'); await wait('!!document.querySelector(".lock") && !document.body.dataset.gateMotion');
  check('锁屏立即清除临时密钥与结果', await evaluate(cdp, '!document.querySelector("#quick-otp-input").value && document.querySelector(".otp-copy").disabled'));
  await unlock(); check('解锁不恢复临时密钥', await evaluate(cdp, '!document.querySelector("#quick-otp-input").value'));
  await evaluate(cdp, 'OTP.store.patchSettings({theme:"dark",colorScheme:"blue"});OTP.app.applyTheme(false)'); await click('.otp-fold-toggle'); await fill('#quick-otp-input', secret);
  await wait('document.querySelector("#quick-generator").dataset.otpStatus === "ready"'); await shot('popup-dark');
  await evaluate(cdp, 'OTP.store.persist()');
  await setViewport(cdp, 1440, 900, 1); await goto('/index.html'); await wait('!!document.querySelector("#screen.is-in") && !document.querySelector(".lock")');
  await evaluate(cdp, 'OTP.store.patchSettings({view:"grid",theme:"light"});OTP.app.applyTheme(false);OTP.app.renderAll({stagger:false})');
  await sleep(450); await shot('dashboard-light');
  await evaluate(cdp, 'OTP.store.patchSettings({theme:"dark"});OTP.app.applyTheme(false)'); await shot('dashboard-dark');
  await click('#side-settings'); await sleep(450); await shot('settings-dark');
  check('设置提供无密钥入口和说明', await evaluate(cdp, 'document.querySelector(".entry-code").textContent.endsWith("#otp=YOUR_BASE32_SECRET")'));
  check('所有测试页面无未捕获异常', errors.length === 0);
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ checks: count, errors, metrics, networkRequestCount: requests.length, extensionId: new URL(base).host }, null, 2));
  console.log(`OTP 浏览器检查 ${count} 项通过。原生地址栏选择事件由 otp-core-test 单独验证。`);
} catch (error) {
  if (cdp) { await shot('failure').catch(() => {}); console.error(await evaluate(cdp, 'document.body.innerText').catch(() => '')); }
  throw error;
} finally { cdp?.close(); worker?.close(); child.kill(); }
