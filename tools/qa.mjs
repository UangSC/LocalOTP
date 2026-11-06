#!/usr/bin/env node
/* ==========================================================================
   LocalOTP · 端到端自检
   --------------------------------------------------------------------------
   在真实的 Edge 里跑一遍主要交互，断言 DOM 与 store 的状态一致：
   解锁、搜索聚光、新增 / 编辑 / 删除、分类筛选、主题、锁定与冷却、
   以及宽屏管理页的导航筛选。

   用法：node tools/qa.mjs
   ========================================================================== */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CDP,
  evaluate,
  findBrowser,
  goto,
  launchBrowser,
  setViewport,
  sleep,
  startServer,
} from "./cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PASSWORD = "2FA2026";

let passed = 0;
const failures = [];
const consoleErrors = [];

function assert(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? "  " + detail : ""}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const num = (value) => (typeof value === "number" ? value : NaN);

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error("没找到可用的 Edge / Chromium");
    process.exit(1);
  }

  const { server, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}`;
  const { process: browser, target } = await launchBrowser(browserPath, 9344);

  const cdp = await CDP.connect(target.webSocketDebuggerUrl, (method, params) => {
    if (method === "Runtime.exceptionThrown") {
      const text = params.exceptionDetails.exception?.description || params.exceptionDetails.text;
      consoleErrors.push("exception: " + String(text).split("\n")[0]);
    }
    if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      consoleErrors.push(
        "console.error: " +
          params.args.map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(" ")
      );
    }
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await setViewport(cdp, 402, 600);

  /* ======================================================================
     弹窗
     ====================================================================== */

  section("门禁");

  await goto(cdp, base + "/popup.html?qa");
  await evaluate(cdp, "localStorage.clear(); OTP.store.wipe().then(() => true)");
  await goto(cdp, base + "/popup.html?qa2");
  await sleep(300);

  assert("首次打开展示「设置密码」", (await evaluate(cdp, "!!document.querySelector('.lock h1')")) === true);
  assert(
    "未解锁时主屏 inert",
    (await evaluate(cdp, "document.querySelector('#screen').hasAttribute('inert')")) === true
  );

  await evaluate(
    cdp,
    `(async () => { await OTP.store.setPassword(${JSON.stringify(PASSWORD)}); return true; })()`
  );
  await evaluate(cdp, "location.replace('/popup.html?qa3')");
  await sleep(700);
  assert(
    "已有密码时展示解锁界面",
    (await evaluate(cdp, "document.querySelector('#pw-lock').getAttribute('placeholder')")) === "管理密码"
  );

  // 错误密码
  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#pw-lock'); i.value = 'wrong'; document.querySelector('.lock-form').requestSubmit(); return true; })()`
  );
  await sleep(500);
  assert(
    "错误密码出现抖动与提示",
    (await evaluate(cdp, "document.querySelector('.lock-err').classList.contains('is-show')")) === true
  );

  // 正确密码
  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#pw-lock'); i.value = ${JSON.stringify(PASSWORD)}; document.querySelector('.lock-form').requestSubmit(); return true; })()`
  );
  await sleep(1300);
  assert("解锁后锁屏移除", (await evaluate(cdp, "!document.querySelector('.lock')")) === true);
  assert(
    "解锁后主屏可交互",
    (await evaluate(cdp, "!document.querySelector('#screen').hasAttribute('inert')")) === true
  );

  /* ---- 列表 ---- */

  section("列表与倒计时");

  const storeCount = num(await evaluate(cdp, "OTP.store.accounts().length"));
  const domCount = num(await evaluate(cdp, "document.querySelectorAll('#list .item').length"));
  assert(`渲染条目数与 store 一致（${storeCount}）`, storeCount === domCount, `${domCount} vs ${storeCount}`);

  assert(
    "验证码已格式化为两组",
    /^\d{3} \d{3}$/.test(await evaluate(cdp, "document.querySelector('#list .code').textContent")),
    await evaluate(cdp, "document.querySelector('#list .code').textContent")
  );

  // 弧长 = 100 - 秒/周期×100，刚跨周期时正好是 0（满格），所以这里只校验区间 + 会随秒推进
  const ringOffset = num(
    await evaluate(cdp, "Number(document.querySelector('#list .ring-bar').getAttribute('stroke-dashoffset'))")
  );
  assert("进度环弧长在合法区间", ringOffset >= 0 && ringOffset <= 100, String(ringOffset));

  await sleep(1300);
  const ringOffset2 = num(
    await evaluate(cdp, "Number(document.querySelector('#list .ring-bar').getAttribute('stroke-dashoffset'))")
  );
  assert("进度环跟着秒数推进", ringOffset2 !== ringOffset, `${ringOffset} → ${ringOffset2}`);

  assert(
    "每行都有邮箱 / 密码 / 验证码三枚复制键",
    (await evaluate(cdp, "document.querySelectorAll('#list .item .qact').length")) === domCount * 3,
    String(await evaluate(cdp, "document.querySelectorAll('#list .item .qact').length"))
  );

  /* ---- 搜索 ---- */

  section("搜索聚光");

  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#search-input'); i.value = 'gitlab'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`
  );
  await sleep(500);
  const hitCount = num(await evaluate(cdp, "document.querySelectorAll('#list .item.is-match').length"));
  const dimCount = num(await evaluate(cdp, "document.querySelectorAll('#list .item.is-dim').length"));
  assert("命中 1 条", hitCount === 1, String(hitCount));
  assert("其余被压暗而不是隐藏", dimCount === storeCount - 1, String(dimCount));
  assert(
    "命中文字被 mark 包裹",
    (await evaluate(cdp, "document.querySelectorAll('#list .item.is-match mark.hl').length")) >= 1
  );
  assert(
    "匹配计数显示 1/n",
    (await evaluate(cdp, "document.querySelector('#match-pill').textContent")) === `1/${storeCount}`
  );

  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#search-input'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`
  );
  await sleep(400);
  assert(
    "清空搜索后恢复全部",
    (await evaluate(cdp, "document.querySelectorAll('#list .item.is-dim').length")) === 0
  );

  /* ---- 新增 ---- */

  section("新增 / 校验 / 编辑");

  await evaluate(cdp, "OTP.sheets.openEditor(null)");
  await sleep(500);
  assert("抽屉打开", (await evaluate(cdp, "document.querySelector('.sheet').classList.contains('is-open')")) === true);

  // 空表单提交 → 三个必填项报错
  await evaluate(cdp, "document.querySelector('.sheet-foot .btn-primary').click()");
  await sleep(300);
  assert(
    "空表单标出必填错误",
    (await evaluate(cdp, "document.querySelectorAll('.sheet .field.is-bad').length")) === 3,
    String(await evaluate(cdp, "document.querySelectorAll('.sheet .field.is-bad').length"))
  );

  // 填正确数据
  await evaluate(
    cdp,
    `(() => {
       const set = (sel, v) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('input', {bubbles:true})); };
       set('#f-email', 'qa.new@example.com');
       set('#f-pass', 'QaPass#2026');
       set('#f-issuer', 'QA Service');
       set('#f-secret', 'JBSWY3DPEHPK3PXP');
       return true; })()`
  );
  await sleep(500);
  assert("密钥合法时出现实时预览", (await evaluate(cdp, "!document.querySelector('.live').hidden")) === true);

  await evaluate(cdp, "document.querySelector('.sheet-foot .btn-primary').click()");
  await sleep(900);
  const afterAdd = num(await evaluate(cdp, "OTP.store.accounts().length"));
  assert("新增后 store 计数 +1", afterAdd === storeCount + 1, `${afterAdd} vs ${storeCount + 1}`);
  assert(
    "新增项出现在列表里",
    (await evaluate(cdp, "!!document.querySelector('#list .item[data-id=\"' + OTP.store.accounts().find(a => a.email === 'qa.new@example.com').id + '\"]')")) === true
  );

  // 编辑
  await evaluate(cdp, "OTP.sheets.openEditor(OTP.store.accounts().find(a => a.email === 'qa.new@example.com'))");
  await sleep(500);
  await evaluate(
    cdp,
    `(() => { const n = document.querySelector('#f-issuer'); n.value = 'QA Renamed'; n.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('.sheet-foot .btn-primary').click(); return true; })()`
  );
  await sleep(700);
  assert(
    "编辑写入 store",
    (await evaluate(cdp, "OTP.store.accounts().find(a => a.email === 'qa.new@example.com').issuer")) === "QA Renamed"
  );

  /* ---- 删除（右键菜单 → 确认框）---- */

  section("删除确认");

  await evaluate(
    cdp,
    `(() => {
       const id = OTP.store.accounts().find(a => a.email === 'qa.new@example.com').id;
       const row = document.querySelector('#list .item[data-id="' + id + '"]');
       row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 220 }));
       return true; })()`
  );
  await sleep(400);
  assert("右键打开菜单", (await evaluate(cdp, "document.querySelector('.menu').classList.contains('is-open')")) === true);

  await evaluate(
    cdp,
    `(() => {
       const items = [...document.querySelectorAll('.menu button')];
       const del = items.find(b => b.textContent.includes('删除'));
       del.click();
       return true; })()`
  );
  await sleep(400);
  assert("弹出二次确认", (await evaluate(cdp, "document.querySelector('.dialog').classList.contains('is-open')")) === true);

  await evaluate(
    cdp,
    `(() => { const btns = [...document.querySelectorAll('.dialog-acts .btn')]; btns[1].click(); return true; })()`
  );
  await sleep(700);
  assert(
    "确认后账号被删除",
    (await evaluate(cdp, "OTP.store.accounts().length")) === storeCount
  );

  /* ---- 弹窗的快速复制 ---- */

  section("弹窗快速复制");

  await evaluate(
    cdp,
    `(() => { window.__copied = []; OTP.copyText = async (v) => { window.__copied.push(v); return true; }; return true; })()`
  );

  const firstRowId = await evaluate(cdp, "document.querySelector('#list .item').dataset.id");
  const firstEmail = await evaluate(cdp, `OTP.store.byId(${JSON.stringify(firstRowId)}).email`);
  const firstPass = await evaluate(cdp, `OTP.store.byId(${JSON.stringify(firstRowId)}).password`);

  await evaluate(cdp, "(() => { document.querySelectorAll('#list .item .qact')[0].click(); return true; })()");
  await sleep(320);
  assert("点「邮箱」键复制邮箱", (await evaluate(cdp, "window.__copied[0]")) === firstEmail);

  await evaluate(cdp, "(() => { document.querySelectorAll('#list .item .qact')[1].click(); return true; })()");
  await sleep(320);
  assert("点「密码」键复制密码", (await evaluate(cdp, "window.__copied[1]")) === firstPass);

  await evaluate(cdp, "(() => { document.querySelectorAll('#list .item .qact')[2].click(); return true; })()");
  await sleep(420);
  const copiedCode = String(await evaluate(cdp, "window.__copied[2]"));
  assert("点验证码键复制 6/8 位码", /^\d{6}$|^\d{8}$/.test(copiedCode), copiedCode);
  assert(
    "复制成功的按钮变「已复制」",
    (await evaluate(cdp, "document.querySelectorAll('#list .item .qact.is-done').length")) >= 1
  );

  /* ---- 快速添加 ---- */

  section("快速添加");

  assert(
    "小窗有方形快速添加键",
    (await evaluate(cdp, "!!document.querySelector('#quick-add-btn')")) === true
  );

  const beforeQuick = num(await evaluate(cdp, "OTP.store.accounts().length"));
  await evaluate(cdp, "(() => { document.querySelector('#quick-add-btn').click(); return true; })()");
  await sleep(600);
  await evaluate(
    cdp,
    `(() => {
       const t = document.querySelector('.quick-input');
       t.value = 'quick.add@example.com--Qp#2026--JBSWY3DPEHPK3PXP\\n这一行没有分隔符';
       t.dispatchEvent(new Event('input', { bubbles: true }));
       return true; })()`
  );
  await sleep(400);
  assert(
    "边打边解析：给出了可加数量",
    (await evaluate(cdp, "document.querySelector('.quick-stats b').textContent")) === "1",
    await evaluate(cdp, "document.querySelector('.quick-stats b').textContent")
  );
  assert(
    "无效行给出了原因",
    (await evaluate(cdp, "!document.querySelector('.quick-hint').hidden")) === true
  );

  await evaluate(
    cdp,
    "(() => { document.querySelector('.sheet-foot .btn-primary').click(); return true; })()"
  );
  await sleep(900);
  assert(
    "快速添加写入 1 条",
    (await evaluate(cdp, "OTP.store.accounts().length")) === beforeQuick + 1,
    `${await evaluate(cdp, "OTP.store.accounts().length")} vs ${beforeQuick + 1}`
  );
  assert(
    "`--` 分隔也能识别",
    (await evaluate(cdp, "!!OTP.store.accounts().find(a => a.email === 'quick.add@example.com')")) === true
  );

  /* ---- 聚焦锁定 ---- */

  section("聚焦锁定");

  await evaluate(
    cdp,
    "(() => { const row = document.querySelectorAll('#list .item')[1]; row.querySelector('.q-pin').click(); return true; })()"
  );
  await sleep(500);
  assert("出现聚焦胶囊", (await evaluate(cdp, "!document.querySelector('#focus-pill').hidden")) === true);
  assert(
    "只有一条被锁定",
    (await evaluate(cdp, "document.querySelectorAll('#list .item.is-focus-lock').length")) === 1
  );
  assert(
    "其余条目变暗",
    (await evaluate(cdp, "document.querySelectorAll('#list .item.is-dim').length")) >= 1
  );

  await evaluate(
    cdp,
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
  );
  await sleep(400);
  assert("Esc 退出聚焦", (await evaluate(cdp, "document.querySelector('#focus-pill').hidden")) === true);
  assert(
    "变暗状态被清掉",
    (await evaluate(cdp, "document.querySelectorAll('#list .item.is-dim').length")) === 0
  );

  /* ---- 倒计时环与数字是否同步 ---- */

  section("倒计时环同步");

  const rings = JSON.parse(
    await evaluate(
      cdp,
      `JSON.stringify([...document.querySelectorAll('#list .item')].map((row) => {
         const acc = OTP.store.byId(row.dataset.id);
         const n = Number(row.querySelector('.ring-num').textContent);
         const off = Number(row.querySelector('.ring-bar').getAttribute('stroke-dashoffset'));
         return { period: acc.period, n, off, expect: Math.round((100 - (n / acc.period) * 100) * 10) / 10 };
       }))`
    )
  );
  assert("每条账号都渲染了进度环", rings.length >= 1, String(rings.length));
  assert(
    "弧长严格等于「显示的秒数 / 周期」",
    rings.every((r) => Math.abs(r.off - r.expect) < 0.05),
    JSON.stringify(rings.slice(0, 3))
  );
  const perPeriod = new Map();
  for (const r of rings) {
    if (!perPeriod.has(r.period)) perPeriod.set(r.period, new Set());
    perPeriod.get(r.period).add(r.n + "|" + r.off);
  }
  assert(
    "同周期的账号进度完全一致",
    [...perPeriod.values()].every((set) => set.size === 1),
    [...perPeriod.entries()].map(([p, s]) => p + "s:" + [...s].join(",")).join(" / ")
  );

  /* ---- 主题 ---- */

  section("主题");

  await evaluate(cdp, "(() => { OTP.store.patchSettings({theme:'dark'}); OTP.app.applyTheme(false); return true; })()");
  await sleep(300);
  assert("切到深色", (await evaluate(cdp, "document.documentElement.dataset.theme")) === "dark");
  assert(
    "深色下卡片底色确实变了",
    (await evaluate(cdp, "getComputedStyle(document.querySelector('#list .item')).backgroundColor")) !==
      "rgb(255, 255, 255)"
  );

  await evaluate(cdp, "(() => { OTP.store.patchSettings({theme:'light'}); OTP.app.applyTheme(false); return true; })()");
  await sleep(300);
  assert("切回浅色", (await evaluate(cdp, "document.documentElement.dataset.theme")) === "light");

  /* ---- 设置面板 ---- */

  section("设置面板与分类管理");

  await evaluate(cdp, "OTP.sheets.openManage('settings')");
  await sleep(600);
  assert(
    "设置分组齐全",
    (await evaluate(cdp, "document.querySelectorAll('.sheet .set-group').length")) >= 5,
    String(await evaluate(cdp, "document.querySelectorAll('.sheet .set-group').length"))
  );

  const catsBefore = num(await evaluate(cdp, "OTP.store.categories().length"));
  await evaluate(
    cdp,
    `(() => { const row = [...document.querySelectorAll('.sheet .set-row.is-tap')][0]; row.click(); return true; })()`
  );
  await sleep(600);
  assert(
    "打开分类管理",
    (await evaluate(cdp, "document.querySelectorAll('.cat-manager .cat-row-item').length")) === catsBefore
  );

  await evaluate(
    cdp,
    `(() => {
       const add = [...document.querySelectorAll('.sheet-foot .btn')].find(b => b.textContent.includes('新增分类'));
       add.click();
       return true; })()`
  );
  await sleep(600);
  // 分类图标的选中态
  assert(
    "分类图标默认选中一个",
    (await evaluate(cdp, "document.querySelectorAll('.icon-option.is-on').length")) === 1
  );

  await evaluate(
    cdp,
    `(() => {
       const input = document.querySelector('.sheet input[type=text]');
       input.value = 'QA 分类';
       input.dispatchEvent(new Event('input', {bubbles:true}));
       const save = [...document.querySelectorAll('.sheet-foot .btn')].find(b => b.textContent.includes('创建分类'));
       save.click();
       return true; })()`
  );
  await sleep(700);
  assert(
    "新建分类写入 store",
    (await evaluate(cdp, "OTP.store.categories().length")) === catsBefore + 1,
    `${await evaluate(cdp, "OTP.store.categories().length")} vs ${catsBefore + 1}`
  );

  await evaluate(cdp, "OTP.ui.closeSheet(true)");
  await sleep(500);

  /* ---- 改密 ---- */

  section("修改管理密码");

  await evaluate(cdp, "OTP.sheets.openPasswordFlow()");
  await sleep(600);
  await evaluate(
    cdp,
    `(() => {
       const inputs = [...document.querySelectorAll('.sheet .field-input input')];
       inputs[0].value = 'wrong-one';
       inputs[1].value = 'NewPass#2026';
       inputs[2].value = 'NewPass#2026';
       [...document.querySelectorAll('.sheet-foot .btn')].find(b => b.textContent.includes('保存新密码')).click();
       return true; })()`
  );
  await sleep(900);
  assert(
    "当前密码错误时拒绝修改",
    (await evaluate(cdp, "document.querySelectorAll('.sheet .field.is-bad').length")) >= 1
  );

  await evaluate(
    cdp,
    `(() => {
       const inputs = [...document.querySelectorAll('.sheet .field-input input')];
       inputs[0].value = ${JSON.stringify(PASSWORD)};
       [...document.querySelectorAll('.sheet-foot .btn')].find(b => b.textContent.includes('保存新密码')).click();
       return true; })()`
  );
  await sleep(1200);
  assert(
    "新密码写入摘要",
    (await evaluate(cdp, "OTP.store.verifyPassword('NewPass#2026')")) === true
  );
  assert(
    "旧密码失效",
    (await evaluate(cdp, "OTP.store.verifyPassword(" + JSON.stringify(PASSWORD) + ")")) === false
  );

  // 改回去，方便后面的锁定测试
  await evaluate(cdp, `OTP.store.setPassword(${JSON.stringify(PASSWORD)}).then(() => true)`);
  await sleep(600);

  /* ---- 备份 ---- */

  section("备份");

  assert(
    "导出负载包含全部账号",
    (await evaluate(cdp, "OTP.store.exportPayload().accounts.length")) ===
      (await evaluate(cdp, "OTP.store.accounts().length"))
  );
  assert(
    "导出负载不含管理密码摘要",
    (await evaluate(cdp, "JSON.stringify(OTP.store.exportPayload()).includes('hash')")) === false
  );

  /* ---- 锁定与冷却 ---- */

  section("锁定与节流");

  await evaluate(cdp, "(() => { document.querySelector('#lock-btn').click(); return true; })()");
  await sleep(700);
  assert("点锁定后重新出现锁屏", (await evaluate(cdp, "!!document.querySelector('.lock')")) === true);
  assert(
    "锁定时主屏重新 inert",
    (await evaluate(cdp, "document.querySelector('#screen').hasAttribute('inert')")) === true
  );

  // 连续 5 次错误 → 进入冷却
  for (let i = 0; i < 5; i++) {
    await evaluate(
      cdp,
      `(() => { const input = document.querySelector('#pw-lock'); if (input.disabled) return false; input.value = 'nope' + ${i}; document.querySelector('.lock-form').requestSubmit(); return true; })()`
    );
    await sleep(420);
  }
  const cooling = await evaluate(cdp, "!document.querySelector('.lock-cool').hidden");
  assert("5 次失败后进入冷却", cooling === true);
  assert(
    "冷却期间输入被禁用",
    (await evaluate(cdp, "document.querySelector('#pw-lock').disabled")) === true
  );

  /* ======================================================================
     宽屏管理页
     ====================================================================== */

  section("宽屏管理页");

  await setViewport(cdp, 1280, 820);
  await goto(cdp, base + "/index.html?qa");
  await sleep(600);

  const lockCard = await evaluate(
    cdp,
    `(() => { const r = document.querySelector('.lock-card').getBoundingClientRect(); return { w: Math.round(r.width), left: Math.round(r.left), vw: innerWidth }; })()`
  );
  assert("管理页的登录卡是一张小卡（不铺满）", lockCard && lockCard.w <= 380, JSON.stringify(lockCard));
  assert(
    "登录卡水平居中",
    lockCard && Math.abs(lockCard.left + lockCard.w / 2 - lockCard.vw / 2) < 2,
    JSON.stringify(lockCard)
  );

  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#pw-lock'); i.value = ${JSON.stringify(PASSWORD)}; document.querySelector('.lock-form').requestSubmit(); return true; })()`
  );
  // 按实际完成状态等待；首次图层准备与丰富入场的时间不同于旧版纯淡出。
  for (let i = 0; i < 70; i++) {
    if (await evaluate(cdp, "!document.querySelector('.lock')")) break;
    await sleep(40);
  }

  assert(
    "展开动画结束后锁屏已移除",
    (await evaluate(cdp, "!document.querySelector('.lock')")) === true
  );
  assert(
    "展开动画结束后内容可见",
    (await evaluate(cdp, "getComputedStyle(document.querySelector('#screen')).opacity")) === "1"
  );

  const workId = await evaluate(cdp, "OTP.store.categories()[0].id");
  const workCount = num(
    await evaluate(cdp, `OTP.store.accounts().filter(a => a.categoryId === ${JSON.stringify(workId)}).length`)
  );

  assert(
    "侧栏渲染了分类导航",
    (await evaluate(cdp, "document.querySelectorAll('#nav .nav-item').length")) >= 3,
    String(await evaluate(cdp, "document.querySelectorAll('#nav .nav-item').length"))
  );
  assert(
    "宽屏行出现「最近更新」列",
    (await evaluate(cdp, "document.querySelectorAll('#list .row-time').length")) > 0
  );
  assert(
    "列表视图显示列标题",
    (await evaluate(cdp, "getComputedStyle(document.querySelector('.col-head')).display")) !== "none"
  );

  await evaluate(
    cdp,
    `(() => { OTP.store.patchSettings({view:'grid'}); OTP.app.renderAll({stagger:false}); return true; })()`
  );
  await sleep(500);
  assert(
    "卡片视图隐藏列标题",
    (await evaluate(cdp, "getComputedStyle(document.querySelector('.col-head')).display")) === "none"
  );
  await evaluate(
    cdp,
    `(() => { OTP.store.patchSettings({view:'list'}); OTP.app.renderAll({stagger:false}); return true; })()`
  );
  await sleep(500);

  /* ---- 视图滑动切换 ---- */

  section("视图滑动切换");

  assert("工具栏渲染了滑动开关", (await evaluate(cdp, "!!document.querySelector('.sw-switch')")) === true);
  assert(
    "开关停在列表侧",
    (await evaluate(cdp, "document.querySelector('.sw-switch').dataset.value")) === "list"
  );

  const clickSwitch = async (view = "grid") => {
    const box = await evaluate(cdp, `(() => {
      const r = document.querySelector('.sw-ico[data-id="${view}"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 });
    }
  };

  await clickSwitch();
  await sleep(60);
  const swapAnims = Number(
    await evaluate(cdp, "document.querySelector('#list').getAnimations({subtree:true}).length")
  );
  assert("切换时列表上有滑动过渡动画", swapAnims > 0, String(swapAnims));

  await sleep(700);
  assert(
    "点一下开关就切到卡片",
    (await evaluate(cdp, "document.querySelector('#list').dataset.view")) === "grid",
    await evaluate(cdp, "document.querySelector('#list').dataset.view")
  );
  assert(
    "开关滑块也滑到了卡片侧",
    (await evaluate(cdp, "document.querySelector('.sw-switch').dataset.value")) === "grid"
  );

  // 点击列表选项回到列表。
  await clickSwitch("list");
  await sleep(700);
  assert(
    "再点一下切回列表",
    (await evaluate(cdp, "document.querySelector('#list').dataset.view")) === "list"
  );

  /* ---- 入场 / 退场的配合动画 ---- */

  section("入场与退场的配合动画");

  await evaluate(cdp, "void OTP.app.lock()");
  let sawCollapse = false;
  for (let i = 0; i < 24; i++) {
    if (await evaluate(cdp, "!!document.querySelector('.flip-panel')")) {
      sawCollapse = true;
      break;
    }
    await sleep(50);
  }
  assert("锁定时有面板缩小的过程", sawCollapse === true);
  await sleep(900);
  assert("锁定后出现登录卡", (await evaluate(cdp, "!!document.querySelector('.lock-card')")) === true);
  assert(
    "锁定后页面骨架被隐藏",
    (await evaluate(cdp, "getComputedStyle(document.querySelector('.sidebar')).opacity")) === "0"
  );
  assert("锁定后不留下动画面板", (await evaluate(cdp, "!document.querySelector('.flip-panel')")) === true);

  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#pw-lock'); i.value = ${JSON.stringify(PASSWORD)}; document.querySelector('.lock-form').requestSubmit(); return true; })()`
  );

  let sawPanel = false;
  let sawPart = false;
  for (let i = 0; i < 50; i++) {
    const st = JSON.parse(
      await evaluate(
        cdp,
        "JSON.stringify({ panel: !!document.querySelector('.flip-panel'), part: (document.querySelector('#app') || { getAnimations: () => [] }).getAnimations().length })"
      )
    );
    if (st.panel) sawPanel = true;
    if (st.part > 0) sawPart = true;
    if (sawPanel && sawPart) break;
    await sleep(50);
  }
  assert("解锁时面板在放大", sawPanel === true);
  assert("解锁时页面内容连续显现", sawPart === true);
  await sleep(1200);
  assert("入场结束后骨架完全可见", (await evaluate(cdp, "getComputedStyle(document.querySelector('.sidebar')).opacity")) === "1");

  await evaluate(
    cdp,
    `(() => { const items = [...document.querySelectorAll('#nav .nav-item')]; const target = items.find(n => n.textContent.includes('工作')); target.click(); return true; })()`
  );
  await sleep(600);
  assert(
    "导航切到「工作」后列表被筛选",
    (await evaluate(cdp, "document.querySelectorAll('#list .item').length")) === workCount,
    `${await evaluate(cdp, "document.querySelectorAll('#list .item').length")} vs ${workCount}`
  );
  assert(
    "标题跟着分类变化",
    (await evaluate(cdp, "document.querySelector('#page-title').textContent")) === "工作"
  );

  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#page-search'); i.value = 'gitlab'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`
  );
  await sleep(500);
  assert(
    "宽屏搜索到 0 条（当前在「工作」分类里）",
    (await evaluate(cdp, "document.querySelectorAll('#list .item.is-match').length")) === 0
  );

  /* ---- 收尾 ---- */

  await sleep(200);
  cdp.close();
  browser.kill();
  server.close();

  console.log("");
  const realErrors = [...new Set(consoleErrors)];
  if (realErrors.length) {
    console.log("\x1b[31m页面报错：\x1b[0m");
    for (const err of realErrors) console.log("  · " + err);
  }

  if (failures.length || realErrors.length) {
    for (const failure of failures) console.log(`  \x1b[31m✗ ${failure.name}\x1b[0m ${failure.detail || ""}`);
    console.log(`\n\x1b[31m${failures.length} 项失败\x1b[0m，${passed} 项通过`);
    process.exit(1);
  }
  console.log(`\x1b[32m✓ 全部 ${passed} 项通过，无 console 错误\x1b[0m`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
