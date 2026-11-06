#!/usr/bin/env node
/* ==========================================================================
   LocalOTP · 动画帧率探针
   --------------------------------------------------------------------------
   在真实浏览器里跑一次「管理页解锁 → 卡片展开」动画，用 rAF 采样帧间隔，
   输出平均 FPS、P95 与最差帧。用来验证"展开动画不掉帧"这件事。

     node tools/perf.mjs            # 默认启 GPU 的无头 Edge
     node tools/perf.mjs --sw       # 关掉 GPU，看最差情况（软件光栅）

   注意：--headless 的软件光栅本身对"任何"带动画的图层都只有 ~26fps，
   所以 --sw 的数字只适合做相对比较（我们的动画 vs 一个纯色块的动画）。
   ========================================================================== */

import { spawn } from "node:child_process";
import { CDP, evaluate, findBrowser, goto, sleep, startServer, createBrowserProfile, cleanProfileOnExit } from "./cdp.mjs";

const software = process.argv.includes("--sw");
const PORT = 9391;

const binary = findBrowser();
if (!binary) {
  console.error("没找到可用的 Edge / Chromium");
  process.exit(1);
}

const { server, port } = await startServer(process.cwd());
const base = `http://127.0.0.1:${port}`;

const profile = createBrowserProfile("perf-");
const flags = [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + profile,
  "about:blank",
];
if (software) flags.splice(1, 0, "--disable-gpu");

const child = spawn(binary, flags, { stdio: "ignore", windowsHide: true });
cleanProfileOnExit(child, profile);

let target = null;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await res.json();
    target = list.find((t) => t.type === "page");
    if (target) break;
  } catch (err) {
    /* 等浏览器起来 */
  }
}
if (!target) {
  console.error("无法连接浏览器");
  child.kill();
  server.close();
  process.exit(1);
}

const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false,
});

await goto(cdp, base + "/index.html");
await evaluate(cdp, "(async () => { await OTP.store.setPassword('2FA2026'); location.reload(); return true; })()");
await sleep(1300);

// 采样器
await evaluate(
  cdp,
  `(() => {
     window.__frames = [];
     let last = 0;
     const loop = (t) => {
       if (last) window.__frames.push({ t, d: t - last });
       last = t;
       requestAnimationFrame(loop);
     };
     requestAnimationFrame(loop);
     return true;
   })()`
);

// 基线：一个纯色块的transform动画（同一环境的"天花板"）
const baseline = await evaluate(
  cdp,
  `(async () => {
     const box = document.createElement('div');
     box.style.cssText = 'position:fixed;left:120px;top:120px;width:322px;height:322px;background:#5b5bf0;border-radius:22px;z-index:9999;will-change:transform,opacity';
     document.body.append(box);
     const frames = []; let last = 0; const t0 = performance.now();
     box.animate(
       [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(-96px,-96px) scale(3.98,2.55)', opacity: 0.2 }],
       { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' }
     );
     await new Promise((r) => {
       const loop = (t) => { if (last) frames.push(t - last); last = t; if (t - t0 < 660) requestAnimationFrame(loop); else r(); };
       requestAnimationFrame(loop);
     });
     box.remove();
     const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
     return { frames: frames.length, fps: Math.round(1000 / avg), avgMs: Math.round(avg * 10) / 10 };
   })()`
);

const trace = [];
if (process.argv.includes("--trace")) {
  cdp.on("Tracing.dataCollected", ({value}) => trace.push(...value));
  await cdp.send("Tracing.start", { categories: "devtools.timeline,blink,cc", options: "record-as-much-as-possible" });
}
// 真实动画
await evaluate(cdp, "(() => { window.__frames.length = 0; return true; })()");
await evaluate(
  cdp,
  "(() => { const i = document.querySelector('#pw-lock'); i.value = '2FA2026'; document.querySelector('.lock-form').requestSubmit(); return true; })()"
);

let startT = null;
for (let i = 0; i < 60; i++) {
  await sleep(16);
  const value = await evaluate(
    cdp,
    "(() => { const p = document.querySelector('.flip-panel'); return p && p.getAnimations().some(a => a.playState === 'running') ? performance.now() : 0; })()"
  );
  if (value) {
    startT = value;
    break;
  }
}
await sleep(900);

const stats = await evaluate(
  cdp,
  `(() => {
     const frames = window.__frames,
       t0 = ${JSON.stringify(startT)};
     const seg = frames
       .filter((x) => x.t >= t0 - 10 && x.t <= t0 + 800)
       .map((x) => x.d)
       .filter((d) => d > 0)
       .sort((a, b) => a - b);
     if (!seg.length) return null;
     const avg = seg.reduce((a, b) => a + b, 0) / seg.length;
     const p95 = seg[Math.floor(seg.length * 0.95)] || avg;
     return {
       slow: frames.filter(x => x.t >= t0 - 10 && x.t <= t0 + 800 && x.d > 24).map(x => ({ at: Math.round(x.t-t0), ms: Math.round(x.d) })),
       frames: seg.length,
       fps: Math.round(1000 / avg),
       p95Fps: Math.round(1000 / p95),
       worstMs: Math.round(seg[seg.length - 1] * 10) / 10,
     };
   })()`
);

console.log("");
console.log(`模式：${software ? "软件光栅（--disable-gpu，最差情况）" : "启用 GPU 的无头 Edge"}`);
console.log(`基线（纯色块同款动画）：${baseline ? baseline.fps + " fps / " + baseline.avgMs + "ms 平均帧" : "—"}`);
console.log(`解锁展开动画：        ${stats ? stats.fps + " fps / P95 " + stats.p95Fps + " fps / 最差 " + stats.worstMs + "ms" : "—"}`);
console.log("");

// 连续往返：覆盖锁屏与热解锁，按完整调用窗口采样，含准备时间。
const roundTrips = await evaluate(cdp, `(async () => {
  const samples=[];
  const summarize=(name,start,end)=>{
    const values=window.__frames.filter(x=>x.t>=start && x.t<=end).map(x=>x.d).sort((a,b)=>a-b);
    samples.push({name, elapsedMs:Math.round(end-start), fps:Math.round(1000/(values.reduce((a,b)=>a+b,0)/values.length)), worstMs:Math.round(Math.max(...values))});
  };
  for(let i=0;i<3;i++) {
    let start=performance.now(); await OTP.app.lock(); summarize('lock-'+(i+1),start,performance.now());
    await new Promise(r=>setTimeout(r,100));
    start=performance.now();
    document.querySelector('#pw-lock').value='2FA2026'; document.querySelector('.lock-form').requestSubmit();
    await new Promise(resolve=>{ const poll=()=>document.querySelector('.lock') ? setTimeout(poll,20):resolve(); poll(); });
    summarize('unlock-'+(i+1),start,performance.now());
    await new Promise(r=>setTimeout(r,100));
  }
  return samples;
})()`);
console.log('连续往返（含校验与准备）：' + JSON.stringify(roundTrips));

if (process.argv.includes("--trace")) {
  const complete = new Promise(r => cdp.on("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end"); await complete;
  console.log(JSON.stringify(trace.filter(x => x.dur > 5000 && !/RunTask|ThreadController|ThreadPool/.test(x.name)).sort((a,b)=>b.dur-a.dur).slice(0,25).map(x=>({name:x.name,ms:Math.round(x.dur/1000),args:x.args})),null,2));
}
if (process.argv.includes("--details")) console.log(JSON.stringify(stats));
cdp.close();
child.kill();
server.close();

if (!stats) process.exitCode = 1;
