/* 从实际浏览器录制动效；只使用演示账号，不接触现有浏览器配置。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CDP, evaluate, findBrowser, goto, launchBrowser, setViewport, sleep, startServer } from "./cdp.mjs";
const { server, port } = await startServer(process.cwd());
const { process: browser, target } = await launchBrowser(findBrowser(), 9386, {gpu:true});
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const frames = [];
const destination = resolve("../Merge2FA-test-cache/motion-capture.json");
async function waitFor(expression) {
  for (let i=0;i<100;i++) { if(await evaluate(cdp,expression)) return; await sleep(40); }
  throw new Error("等待页面超时");
}
try {
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await setViewport(cdp, 1440, 900, 1);
  const url=`http://127.0.0.1:${port}/index.html`;
  await goto(cdp,url); await evaluate(cdp,"OTP.store.setPassword('motion-demo')"); await goto(cdp,url+"?demo");
  // 先完成一次正常往返，再录制；避免把浏览器冷启动加载时间当成交互动效。
  await evaluate(cdp, `document.querySelector('#pw-lock').value='motion-demo'; document.querySelector('.lock-form').requestSubmit(); void 0`);
  await waitFor("!document.querySelector('.lock')"); await sleep(700);
  await evaluate(cdp,"OTP.app.lock()"); await sleep(300);
  cdp.on("Page.screencastFrame", ({data, metadata, sessionId}) => {
    frames.push({data, time: metadata.timestamp});
    cdp.send("Page.screencastFrameAck", {sessionId}).catch(()=>{});
  });
  await cdp.send("Page.startScreencast", {format:"jpeg",quality:85,maxWidth:960,maxHeight:600,everyNthFrame:1});
  await sleep(500);
  await evaluate(cdp, `document.querySelector('#pw-lock').value='motion-demo'; document.querySelector('.lock-form').requestSubmit(); void 0`);
  await waitFor("!document.querySelector('.lock')"); await sleep(650);
  await evaluate(cdp, `document.querySelector('.sw-ico[data-id="grid"]').click()`); await sleep(1100);
  const point=await evaluate(cdp,`(()=>{const r=document.querySelector('.card').getBoundingClientRect();return {x:r.left+r.width*.65,y:r.top+r.height*.3}})()`);
  await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",...point}); await sleep(650);
  await evaluate(cdp,`document.querySelector('.sw-ico[data-id="list"]').click()`); await sleep(1000);
  await evaluate(cdp,"OTP.app.lock()"); await sleep(600);
  await cdp.send("Page.stopScreencast");
  mkdirSync(resolve("../Merge2FA-test-cache"),{recursive:true});
  writeFileSync(destination,JSON.stringify(frames));
  console.log(`实际浏览器采集 ${frames.length} 帧：${destination}`);
} finally { cdp.close(); browser.kill(); server.close(); }
