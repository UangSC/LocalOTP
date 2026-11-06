#!/usr/bin/env node
/* ==========================================================================
   LocalOTP · 截图
   --------------------------------------------------------------------------
   起本地静态服务，用无头 Edge 通过 CDP 真实渲染两种形态与各个状态，
   顺手把页面的 console 错误也抓出来。

   用法：node tools/shots.mjs [--only=03,18]
   ========================================================================== */

import { mkdirSync, writeFileSync } from "node:fs";
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
const OUT = join(ROOT, "docs", "shots");
const PASSWORD = "2FA2026";

const only = (() => {
  const arg = process.argv.find((a) => a.startsWith("--only="));
  return arg ? new Set(arg.slice(7).split(",")) : null;
})();

const problems = [];

/**
 * 截图前先"抖"几帧。
 * 无头浏览器不跑常规帧循环，合成器上的 opacity/transform 过渡只有在出帧时才推进，
 * 直接截会拍到过渡中间态（卡片看着半透明、验证码发虚）。
 */
async function settle(cdp) {
  await evaluate(
    cdp,
    "(() => { let n = 0; const step = () => { if (++n < 6) requestAnimationFrame(step); }; requestAnimationFrame(step); return true; })()"
  );
  await sleep(160);
}

async function shoot(cdp, name, note) {
  if (only && !only.has(name.slice(0, 2))) return;
  await settle(cdp);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  writeFileSync(join(OUT, name + ".png"), Buffer.from(shot.data, "base64"));
  console.log(`  \x1b[36m✓\x1b[0m ${name}.png${note ? "  \x1b[2m" + note + "\x1b[0m" : ""}`);
}

/**
 * 等一个"安全时刻"再截图：
 *   1) 剩余时间要够长，别让整屏变成告警色；
 *   2) 换码翻牌动画要已经跑完，否则验证码会被拍成虚的。
 */
async function calm(cdp) {
  for (let i = 0; i < 140; i++) {
    const state = await evaluate(
      cdp,
      `(() => ({
         remaining: OTP.totp.cycle(30).remaining,
         animating: [...document.querySelectorAll('.code, .ring-bar, .ring-glow')].some(
           (n) => n.getAnimations().length > 0
         ),
       }))()`
    );
    if (!state || state.remaining === null) return;
    if (state.remaining > 21 && !state.animating) break;
    await sleep(220);
  }
  await sleep(300);
}

async function unlock(cdp) {
  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#pw-lock'); i.value = ${JSON.stringify(PASSWORD)}; document.querySelector('.lock-form').requestSubmit(); return true; })()`
  );
  await sleep(1500);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const binary = findBrowser();
  if (!binary) {
    console.error("没找到可用的 Edge / Chromium");
    process.exit(1);
  }

  const { server, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}`;
  console.log(`\x1b[2m静态服务 ${base}\x1b[0m`);

  const { process: browser, target } = await launchBrowser(binary, 9333);

  const cdp = await CDP.connect(target.webSocketDebuggerUrl, (method, params) => {
    if (method === "Runtime.exceptionThrown") {
      const d = params.exceptionDetails;
      const frame = (d.stackTrace && d.stackTrace.callFrames && d.stackTrace.callFrames[0]) || null;
      const where = frame
        ? ` @ ${frame.url.split("/").pop()}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`
        : "";
      problems.push("exception: " + String(d.exception?.description || d.text).split("\n")[0] + where);
      if (d.stackTrace && d.stackTrace.callFrames) {
        for (const f of d.stackTrace.callFrames.slice(0, 4)) {
          problems.push("   ↳ " + f.functionName + " @ " + f.url.split("/").pop() + ":" + (f.lineNumber + 1));
        }
      } else {
        problems.push("   ↳ (no stack) url=" + (d.url || "-"));
      }
    }
    if (method === "Runtime.consoleAPICalled" && (params.type === "error" || params.type === "warning")) {
      problems.push(
        params.type +
          ": " +
          params.args.map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(" ")
      );
    }
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });

  /* ======================================================================
     小窗（弹窗）
     ====================================================================== */

  console.log("\n\x1b[1m弹窗形态\x1b[0m");
  await setViewport(cdp, 402, 600);

  await goto(cdp, base + "/popup.html?fresh");
  await evaluate(cdp, "localStorage.clear(); OTP.store.wipe().then(() => true)");
  await goto(cdp, base + "/popup.html?fresh2");
  await sleep(400);
  await shoot(cdp, "01-lock-create", "首次设置管理密码");

  await evaluate(
    cdp,
    `(async () => { await OTP.store.setPassword(${JSON.stringify(PASSWORD)}); location.replace('/popup.html'); })()`
  );
  await sleep(900);
  await shoot(cdp, "02-lock-unlock", "再次打开需解锁");

  await unlock(cdp);
  await calm(cdp);
  await shoot(cdp, "03-list", "三枚复制键 + 倒计时环");

  /* 复制验证码 */
  await evaluate(
    cdp,
    `(() => { window.__copied = []; OTP.copyText = async (v) => { window.__copied.push(v); return true; }; return true; })()`
  );
  await evaluate(cdp, "(() => { document.querySelectorAll('#list .item .qact')[2].click(); return true; })()");
  await sleep(260);
  await shoot(cdp, "04-copy", "复制验证码：整行泛光 + 键变勾 + Toast");
  await sleep(1100);

  /* 复制邮箱 */
  await evaluate(cdp, "(() => { document.querySelectorAll('#list .item .qact')[0].click(); return true; })()");
  await sleep(220);
  await shoot(cdp, "05-copy-mail", "复制邮箱：按钮就地变「已复制」");
  await sleep(1100);

  /* 聚光搜索（真实鼠标点进输入框，验证焦点只有一层） */
  const searchBox = await evaluate(
    cdp,
    `(() => { const r = document.querySelector('#search-input').getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) }; })()`
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x: searchBox.x, y: searchBox.y, button: "left", clickCount: 1 });
  }
  await sleep(150);
  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#search-input'); i.value = 'steam'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`
  );
  await sleep(700);
  await shoot(cdp, "06-search", "聚光搜索：命中提亮、其余压暗");

  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#search-input'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); i.blur(); return true; })()`
  );
  await sleep(300);

  /* 聚焦锁定 */
  await evaluate(
    cdp,
    "(() => { const row = document.querySelectorAll('#list .item')[1]; row.querySelector('.q-pin').click(); return true; })()"
  );
  await sleep(700);
  await shoot(cdp, "07-focus", "聚焦锁定：只剩一条是亮的");
  await evaluate(cdp, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(400);

  /* 快速添加 */
  await evaluate(cdp, "(() => { document.querySelector('#quick-add-btn').click(); return true; })()");
  await sleep(700);
  await evaluate(
    cdp,
    `(() => {
       const t = document.querySelector('.quick-input');
       t.value = 'nova.studio@example.com--Nova#2026--JBSWY3DPEHPK3PXP\\n第二行故意写错，用来看校验';
       t.dispatchEvent(new Event('input', { bubbles: true }));
       return true; })()`
  );
  await sleep(500);
  await shoot(cdp, "08-quick-add", "快速添加：一行一条，边打边校验");
  await evaluate(cdp, "OTP.ui.closeSheet(false)");
  await sleep(450);

  /* 设置 / 导入 / 编辑 */
  await evaluate(cdp, "OTP.sheets.openManage('settings')");
  await sleep(700);
  await shoot(cdp, "09-settings", "设置面板");

  await evaluate(cdp, "(() => { OTP.ui.closeSheet(true); return true; })()");
  await sleep(420);
  await evaluate(cdp, "OTP.sheets.openImport()");
  await sleep(700);
  await evaluate(
    cdp,
    `(() => { const t = document.querySelector('.imp-input'); t.value = OTP.seed.SAMPLE_IMPORT; t.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`
  );
  await sleep(600);
  await shoot(cdp, "10-import", "批量导入解析预览");

  await evaluate(cdp, "(() => { OTP.ui.closeSheet(true); return true; })()");
  await sleep(420);
  await evaluate(cdp, "OTP.sheets.openEditor(null)");
  await sleep(700);
  await evaluate(
    cdp,
    `(() => {
       const set = (sel, v) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('input', {bubbles:true})); };
       set('#f-email', 'brand.new@example.com');
       set('#f-pass', 'Br@ndNew#2026');
       set('#f-issuer', 'Obsidian');
       set('#f-secret', 'JBSWY3DPEHPK3PXP');
       return true; })()`
  );
  await sleep(900);
  const fieldBox = await evaluate(
    cdp,
    `(() => { const r = document.querySelector('#f-email').getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) }; })()`
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x: fieldBox.x, y: fieldBox.y, button: "left", clickCount: 1 });
  }
  await sleep(300);
  await shoot(cdp, "11-editor", "新增账号 + 实时预览（输入框聚焦只有一层光）");

  /* 深色 */
  await evaluate(
    cdp,
    `(() => { OTP.ui.closeSheet(false); OTP.store.patchSettings({theme:'dark'}); OTP.app.applyTheme(false); OTP.list.scrollToTop(); return true; })()`
  );
  await sleep(900);
  await calm(cdp);
  await shoot(cdp, "12-list-dark", "小窗 · 深色");

  await evaluate(cdp, "OTP.sheets.openManage('settings')");
  await sleep(700);
  await shoot(cdp, "13-settings-dark", "设置 · 深色");

  /* 空状态 / 无匹配 */
  await evaluate(
    cdp,
    `(() => { OTP.ui.closeSheet(false); OTP.store.patchSettings({theme:'light'}); OTP.app.applyTheme(false); OTP.store.replaceAccounts([]); OTP.app.renderAll({stagger:true}); return true; })()`
  );
  await sleep(800);
  await shoot(cdp, "14-empty", "空状态");

  await evaluate(
    cdp,
    `(() => { OTP.store.resetDemo(); OTP.app.renderAll({stagger:true}); const i = document.querySelector('#search-input'); i.value = 'zzz'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`
  );
  await sleep(700);
  await shoot(cdp, "15-nomatch", "搜索无匹配");

  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#search-input'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); OTP.app.renderAll({stagger:true}); return true; })()`
  );
  await sleep(600);

  /* 弹窗外壳 */
  await setViewport(cdp, 520, 700);
  await sleep(400);
  await calm(cdp);
  await shoot(cdp, "16-shell", "弹窗外壳与环境光");

  /* ======================================================================
     大页面（管理页）
     ====================================================================== */

  console.log("\n\x1b[1m管理页形态\x1b[0m");
  await setViewport(cdp, 1280, 820);
  await goto(cdp, base + "/index.html");
  await sleep(1800);
  await shoot(cdp, "17-page-lock", "居中的小登录卡（不再是整屏）");

  await unlock(cdp);
  await calm(cdp);
  await shoot(cdp, "18-page", "宽屏管理页 · 列表");

  await evaluate(
    cdp,
    `(() => { OTP.store.patchSettings({view:'grid'}); OTP.app.renderAll({stagger:true}); return true; })()`
  );
  await sleep(800);
  await shoot(cdp, "19-page-grid", "宽屏 · 卡片视图");

  await evaluate(
    cdp,
    `(() => { OTP.store.patchSettings({view:'list', theme:'dark'}); OTP.app.applyTheme(false); OTP.app.renderAll({stagger:true}); return true; })()`
  );
  await sleep(900);
  await shoot(cdp, "20-page-dark", "宽屏 · 深色");

  await evaluate(
    cdp,
    `(() => { OTP.store.patchSettings({theme:'light'}); OTP.app.applyTheme(false); const i = document.querySelector('#page-search'); i.value = 'dev'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`
  );
  await sleep(800);
  await shoot(cdp, "21-page-search", "宽屏 · 聚光搜索");

  await evaluate(
    cdp,
    `(() => { const i = document.querySelector('#page-search'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); OTP.sheets.openManage('settings'); return true; })()`
  );
  await sleep(1000);
  await shoot(cdp, "22-page-settings", "宽屏 · 设置侧栏");

  cdp.close();
  browser.kill();
  server.close();

  console.log("");
  if (problems.length) {
    console.log("\x1b[31m页面报错：\x1b[0m");
    for (const problem of [...new Set(problems)]) console.log("  · " + problem);
    process.exitCode = 1;
  } else {
    console.log("\x1b[32m✓ 无 console 错误\x1b[0m");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
