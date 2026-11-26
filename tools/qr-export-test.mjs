/* OTP 二维码导出、缓存失效、三视图定位精度、卡片底距与默认分类端到端验收。 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CDP, evaluate, findBrowser, goto, launchBrowser, setViewport, sleep, startServer } from "./cdp.mjs";

const { server, port } = await startServer(process.cwd());
const { process: browser, target } = await launchBrowser(findBrowser(), 0, { gpu: true });
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const shots = resolve("artifacts/qr-export");
mkdirSync(shots, { recursive: true });
const errors = [];
let count = 0;

function check(name, ok, detail) {
  assert.ok(ok, detail ? `${name} (${detail})` : name);
  count++;
  console.log("✓ " + name);
}

async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(shots, name + ".png"), Buffer.from(data, "base64"));
}

async function unlock(pw = "qr-export-test") {
  await evaluate(cdp, `document.querySelector('#pw-lock').value=${JSON.stringify(pw)};document.querySelector('.lock-form').requestSubmit();void 0`);
  for (let i = 0; i < 100; i++) {
    if (await evaluate(cdp, "!document.querySelector('.lock')")) return;
    await sleep(40);
  }
  throw new Error("解锁超时");
}

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", e => errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));

  const base = `http://127.0.0.1:${port}`;

  /* ---- 1. 弹窗视图：默认主题 + 快速添加 OTP 链接 + 二维码位置 + 扫码往返 + 缓存验证 ---- */
  await setViewport(cdp, 402, 600, 1);
  await goto(cdp, base + "/popup.html");
  await evaluate(cdp, "OTP.store.setPassword('qr-export-test')");
  await goto(cdp, base + "/popup.html?run");
  await unlock();
  await sleep(300);

  check("首次默认主题为第 1 套浅色晨曦蓝青", await evaluate(cdp, "OTP.store.settings().theme === 'light' && OTP.store.settings().colorScheme === 'ocean' && document.documentElement.dataset.theme === 'light' && document.documentElement.dataset.colorScheme === 'ocean'"));

  // 验证快速添加支持 OTP 链接
  await evaluate(cdp, "document.querySelector('#quick-add-btn').click()");
  await sleep(350);
  await evaluate(cdp, `(()=>{
    const t = document.querySelector('.quick-input');
    t.value = 'otpauth://totp/GitHub:quick-otp@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(150);
  check("快速添加支持解析 otpauth:// 链接", await evaluate(cdp, "document.querySelector('.quick-stats b')?.textContent === '1' && !document.querySelector('.sheet-foot .btn-primary').disabled"));
  await evaluate(cdp, "document.querySelector('.sheet-foot .btn-primary').click()");
  await sleep(450);
  check("快速添加成功写入 otpauth 账号", await evaluate(cdp, "OTP.store.accounts().some(a => a.email === 'quick-otp@example.com' && a.issuer === 'GitHub')"));
  await evaluate(cdp, "OTP.store.deleteAccount(OTP.store.accounts().find(a => a.email === 'quick-otp@example.com').id); OTP.app.renderAll({ stagger: false })");
  await sleep(250);

  const popupGeom = await evaluate(cdp, `(()=>{
    const item = document.querySelector('#list .item.quick');
    const ring = item.querySelector('.ring').getBoundingClientRect();
    const code = item.querySelector('.qact-code').getBoundingClientRect();
    const qr = item.querySelector('.qact-qr').getBoundingClientRect();
    return {
      ringRight: Math.round(ring.right), qrRight: Math.round(qr.right),
      ringBottom: Math.round(ring.bottom), qrTop: Math.round(qr.top),
      codeRight: Math.round(code.right), qrLeft: Math.round(qr.left),
      codeTop: Math.round(code.top), qrHeight: Math.round(qr.height),
      codeHeight: Math.round(code.height),
    };
  })()`);
  check("弹窗二维码按钮位于倒计时正下方", popupGeom.qrTop >= popupGeom.ringBottom && Math.abs(popupGeom.qrRight - popupGeom.ringRight) <= 2, JSON.stringify(popupGeom));
  check("弹窗二维码按钮位于验证码框右侧且等高", popupGeom.qrLeft >= popupGeom.codeRight && Math.abs(popupGeom.qrTop - popupGeom.codeTop) <= 1 && Math.abs(popupGeom.qrHeight - popupGeom.codeHeight) <= 1, JSON.stringify(popupGeom));
  await shot("popup-ocean-light");

  // 点击二维码按钮弹出小窗，并用 jsQR 真实解码验证 otpauth 链接
  await evaluate(cdp, "document.querySelector('#list .item.quick .qact-qr').click()");
  await sleep(300);
  check("点击二维码按钮弹出二维码小窗", await evaluate(cdp, "document.querySelector('.dialog.dialog-qr.is-open .qr-modal-img')?.src?.startsWith('data:image/png;base64,')"));
  await shot("popup-qr-modal");

  const decoded = await evaluate(cdp, `(async ()=>{
    const id = document.querySelector('.qr-modal-content').dataset.accountId;
    const acc = OTP.store.byId(id);
    const src = document.querySelector('.qr-modal-img').src;
    const blob = await (await fetch(src)).blob();
    const text = await OTP.qr.decode(blob);
    const parsed = OTP.totp.parseOtpauth(text);
    return { text, parsed, acc: { email: acc.email, issuer: acc.issuer, secret: acc.secret, digits: acc.digits, period: acc.period, algorithm: acc.algorithm }, stats: OTP.qrExport.stats() };
  })()`);
  check("二维码内容可被 jsQR 离线识别为标准 otpauth 链接", decoded.text.startsWith("otpauth://totp/") && decoded.parsed.secret === decoded.acc.secret && decoded.parsed.issuer === decoded.acc.issuer && decoded.parsed.email === decoded.acc.email, JSON.stringify(decoded));
  check("首次打开二维码触发 1 次生成", decoded.stats.generatedCount === 1 && decoded.stats.cacheHitCount === 0, JSON.stringify(decoded.stats));

  // 关闭后再次打开同一账号：应命中缓存不重新生成
  await evaluate(cdp, "OTP.ui.closeModal()");
  await sleep(200);
  await evaluate(cdp, "document.querySelector('#list .item.quick .qact-qr').click()");
  await sleep(250);
  const afterSecond = await evaluate(cdp, "({ stats: OTP.qrExport.stats(), cached: document.querySelector('.qr-modal-content').dataset.cached })");
  check("重复查看同一 OTP 二维码直接命中缓存不重新生成", afterSecond.stats.generatedCount === 1 && afterSecond.stats.cacheHitCount === 1 && afterSecond.cached === "true", JSON.stringify(afterSecond));

  // 修改账号信息（issuer），再次打开二维码：应更新并重新生成
  await evaluate(cdp, `(()=>{
    const id = document.querySelector('.qr-modal-content').dataset.accountId;
    OTP.ui.closeModal();
    OTP.store.updateAccount(id, { issuer: 'Demo Updated QR' });
  })()`);
  await sleep(250);
  await evaluate(cdp, "document.querySelector('#list .item.quick .qact-qr').click()");
  await sleep(250);
  const afterEdit = await evaluate(cdp, `(async ()=>{
    const src = document.querySelector('.qr-modal-img').src;
    const blob = await (await fetch(src)).blob();
    const text = await OTP.qr.decode(blob);
    return { text, parsed: OTP.totp.parseOtpauth(text), stats: OTP.qrExport.stats() };
  })()`);
  check("修改账号后自动更新二维码并刷新内容", afterEdit.stats.generatedCount === 2 && afterEdit.parsed.issuer === "Demo Updated QR", JSON.stringify(afterEdit));
  await evaluate(cdp, "OTP.ui.closeModal()");

  /* ---- 2. 管理页：默认分类 + 列表对齐 + 卡片左下角二维码与底距 ---- */
  await setViewport(cdp, 1360, 860, 1);
  await goto(cdp, base + "/index.html");
  await unlock();
  await sleep(350);

  const defaultCats = await evaluate(cdp, "OTP.store.categories().map(c => ({ id: c.id, name: c.name, icon: c.icon }))");
  for (const [name, icon] of [["Google", "brand-google"], ["GitHub", "brand-github"], ["ChatGPT", "brand-chatgpt"], ["Microsoft", "brand-microsoft"]]) {
    check(`存在默认分类 ${name}（带对应品牌图标）`, defaultCats.some(c => c.name === name && c.icon === icon));
  }

  // 验证默认分类可编辑、可删除且重载后不复活，同时验证分类头像图标 vs 未分类字母头像
  await evaluate(cdp, `(()=>{
    OTP.store.saveCategory({ id: 'cat_google', name: 'Google 主号', icon: 'brand-google' });
    OTP.store.deleteCategory('cat_microsoft');
    const accs = OTP.store.accounts();
    OTP.store.updateAccount(accs[0].id, { categoryId: 'cat_google' });
    OTP.store.updateAccount(accs[1].id, { categoryId: '' });
    return OTP.store.persist();
  })()`);
  await goto(cdp, base + "/index.html?recheck");
  await unlock();
  await sleep(350);
  check("默认分类编辑与删除均生效且重载不复活", await evaluate(cdp, "OTP.store.categories().some(c => c.id === 'cat_google' && c.name === 'Google 主号') && !OTP.store.categories().some(c => c.id === 'cat_microsoft')"));
  check("有分类账号使用对应类别 SVG 图标作为头像，未分类账号使用字母头像", await evaluate(cdp, `(()=>{
    const rows = [...document.querySelectorAll('#list .item.row')];
    const firstAv = rows[0].querySelector('.avatar');
    const secondAv = rows[1].querySelector('.avatar');
    return firstAv.classList.contains('is-cat-icon') && firstAv.dataset.avatarIcon === 'brand-google' && !!firstAv.querySelector('svg') &&
      !secondAv.classList.contains('is-cat-icon') && !!secondAv.querySelector('.avatar-letter') && !secondAv.querySelector('svg');
  })()`));

  // 验证管理页「批量导入」面板布局（双入口卡片对齐扫码视图，无横向溢出）
  await evaluate(cdp, "OTP.sheets.openImport()");
  await sleep(420);
  const impCheck = await evaluate(cdp, `(()=>{
    const pane = document.querySelector('.imp-pane');
    const sources = [...document.querySelectorAll('.imp-sources .imp-source')];
    const r0 = sources[0]?.getBoundingClientRect(), r1 = sources[1]?.getBoundingClientRect();
    const sheetBody = document.querySelector('.sheet-body');
    return {
      hasCards: sources.length === 2 && Math.abs(r0.top - r1.top) <= 1 && r0.right < r1.left,
      noOverflow: sheetBody.scrollWidth <= sheetBody.clientWidth + 1 && pane.getBoundingClientRect().width > 0,
    };
  })()`);
  check("批量导入面板使用双列快捷卡片且无布局溢出", impCheck.hasCards && impCheck.noOverflow, JSON.stringify(impCheck));
  await shot("page-import-light");
  await evaluate(cdp, "OTP.ui.closeSheet(false)");
  await sleep(320);

  // 管理页列表视图检查
  await evaluate(cdp, "OTP.store.patchSettings({ view: 'list', theme: 'light', colorScheme: 'ocean' }); OTP.app.applyTheme(false); OTP.app.renderAll({ stagger: false })");
  await sleep(300);
  const listCheck = await evaluate(cdp, `(()=>{
    const rows = [...document.querySelectorAll('#list .item.row')];
    const qrRights = rows.map(r => Math.round(r.querySelector('.row-tools .mini-qr').getBoundingClientRect().right));
    const isLast = rows.every(r => r.querySelector('.row-tools').lastElementChild.classList.contains('mini-qr'));
    const timeRights = rows.map(r => Math.round(r.querySelector('.row-time').getBoundingClientRect().right));
    const spread = arr => Math.max(...arr) - Math.min(...arr);
    return { count: rows.length, isLast, qrSpread: spread(qrRights), timeSpread: spread(timeRights) };
  })()`);
  check("管理页列表模式二维码位于服务列最后一个小按钮", listCheck.count >= 5 && listCheck.isLast, JSON.stringify(listCheck));
  check("管理页列表模式操作按钮与更新时间纵向严格对齐", listCheck.qrSpread <= 1 && listCheck.timeSpread <= 1, JSON.stringify(listCheck));
  await shot("page-list-ocean");

  // 管理页卡片视图检查
  await evaluate(cdp, "OTP.store.patchSettings({ view: 'grid' }); OTP.app.renderAll({ stagger: false })");
  await sleep(350);
  const cardCheck = await evaluate(cdp, `(()=>{
    const cards = [...document.querySelectorAll('#list .item.card')];
    return cards.slice(0, 6).map(card => {
      const cr = card.getBoundingClientRect();
      const qr = card.querySelector('.card-tools .mini-qr').getBoundingClientRect();
      const right = card.querySelector('.card-tools-right').getBoundingClientRect();
      return {
        leftGap: Math.round(qr.left - cr.left),
        bottomGap: Math.round(cr.bottom - qr.bottom),
        rightGap: Math.round(cr.right - right.right),
        qrLeftOfRight: qr.right < right.left,
      };
    });
  })()`);
  check("管理页卡片模式二维码固定在左下角", cardCheck.every(c => c.leftGap >= 16 && c.leftGap <= 26 && c.qrLeftOfRight), JSON.stringify(cardCheck[0]));
  check("管理页卡片底部按钮留有舒适底距不贴边", cardCheck.every(c => c.bottomGap >= 16), JSON.stringify(cardCheck[0]));
  await shot("page-grid-ocean");

  // 卡片点击二维码按钮也能弹出小窗
  await evaluate(cdp, "document.querySelector('#list .item.card .mini-qr').click()");
  await sleep(300);
  check("卡片二维码按钮弹出二维码小窗", await evaluate(cdp, "document.querySelector('.dialog.dialog-qr').classList.contains('is-open')"));
  await shot("page-qr-modal-light");
  await evaluate(cdp, "OTP.ui.closeModal()");

  // 切换到深色渐变主题截图展示
  for (const [theme, scheme] of [["light", "aurora"], ["light", "sunset"], ["dark", "midnight"], ["dark", "nebula"], ["dark", "ember"]]) {
    await evaluate(cdp, `OTP.store.patchSettings({ theme: ${JSON.stringify(theme)}, colorScheme: ${JSON.stringify(scheme)} }); OTP.app.applyTheme(false);`);
    await sleep(220);
    await shot(`page-grid-${scheme}`);
  }
  await evaluate(cdp, "document.querySelector('#list .item.card .mini-qr').click()");
  await sleep(260);
  await shot("page-qr-modal-dark");
  await evaluate(cdp, "OTP.ui.closeModal(); OTP.sheets.openImport()");
  await sleep(380);
  await shot("page-import-dark");
  await evaluate(cdp, "OTP.ui.closeSheet(false)");

  // 检查 api.html 页脚描述、GitHub SVG 链接及双色背景
  await goto(cdp, base + "/api.html");
  await sleep(300);
  const apiCheck = await evaluate(cdp, `(()=>{
    const footer = document.querySelector('.api-footer');
    const gh = document.querySelector('.api-gh-link');
    return {
      hasOmniboxCopy: footer?.textContent.includes('LocalOTP') && footer?.textContent.includes('地址栏'),
      hasGhSvg: !!gh && gh.href === 'https://github.com/UangSC/LocalOTP' && !!gh.querySelector('svg path'),
      noOverflow: document.documentElement.scrollWidth <= innerWidth,
    };
  })()`);
  check("API 页面包含地址栏调用说明及 GitHub SVG 超链接", apiCheck.hasOmniboxCopy && apiCheck.hasGhSvg && apiCheck.noOverflow, JSON.stringify(apiCheck));
  await shot("api-page-dark");

  assert.deepEqual(errors, [], "页面出现脚本异常");
  console.log(`二维码、默认分类与布局验收 ${count} 项全部通过`);
} finally {
  await cdp.send("Browser.close").catch(() => {});
  cdp.close();
  browser.kill();
  server.close();
}
