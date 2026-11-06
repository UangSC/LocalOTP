/* 恢复工具验证只在隔离、禁用云同步的浏览器里使用公开测试数据。 */
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {CDP,evaluate,findBrowser,sleep,createBrowserProfile,cleanProfileOnExit} from './cdp.mjs';
const index=process.argv.indexOf('--path');if(index<0)throw Error('请用 --path 指定已生成的只读恢复器目录');
const extension=resolve(process.argv[index+1]),expected=readFileSync(join(extension,'expected-id.js'),'utf8').match(/[a-p]{32}/)?.[0];
assert.ok(expected);
const profile=createBrowserProfile('recovery-test-'),port=9403;
const browser=spawn(findBrowser(),['--headless=new','--no-first-run','--disable-sync',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,`--load-extension=${extension}`,'about:blank'],{stdio:'ignore',windowsHide:true});
cleanProfileOnExit(browser,profile);
let page,count=0;const check=(name,ok)=>{assert.ok(ok,name);count++;console.log('✓ '+name)};
async function wait(expression){for(let i=0;i<100;i++){if(await evaluate(page,expression))return;await sleep(50)}throw Error('等待超时')}
try{
 let target;for(let i=0;i<100;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(target)break}catch{}await sleep(100)}
 page=await CDP.connect(target.webSocketDebuggerUrl);
 await page.send('Page.navigate',{url:`chrome-extension://${expected}/recovery.html`});await sleep(500);
 await wait('document.querySelector("#status")?.textContent.includes("尚未找到")');
 check('恢复目录加载后 ID 与旧 ID 一致',await evaluate(page,`chrome.runtime.id==='${expected}'`));
 check('空缓存禁用导出，避免误导生成空备份',await evaluate(page,'document.querySelector("#export-sync").disabled && document.querySelector("#export-local").disabled'));
 await evaluate(page,`chrome.storage.sync.set({'acc:old':{id:'old',email:'public@example.com',secret:'JBSWY3DPEHPK3PXP',createdAt:1,updatedAt:1},'acc:removed':{id:'removed',email:'removed@example.com',secret:'JBSWY3DPEHPK3PXP',createdAt:1,updatedAt:1},'tomb:removed':2})`);
 await wait('document.querySelector("#sync-count").textContent.includes("1 条")');
 check('读取旧格式且保留删除语义',await evaluate(page,'!document.querySelector("#export-sync").disabled'));
 const before=await evaluate(page,'Promise.all([chrome.storage.local.get(null),chrome.storage.sync.get(null)]).then(JSON.stringify)');
 await evaluate(page,'document.querySelector("#refresh").click()');await sleep(100);
 check('刷新不改变本机或同步数据',before===await evaluate(page,'Promise.all([chrome.storage.local.get(null),chrome.storage.sync.get(null)]).then(JSON.stringify)'));
 await evaluate(page,`window.savedBlob=null;URL.createObjectURL=b=>{savedBlob=b;return 'blob:test'};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){window.exportName=this.download};document.querySelector('#export-sync').click()`);
 const result=await evaluate(page,'savedBlob.text().then(JSON.parse)');
 check('导出是可导入的 LocalOTP 备份格式',result.format==='localotp.backup'&&result.version===2&&result.accounts.length===1&&result.accounts[0].id==='old');
 check('恢复器仅申请存储权限且没有后台写入器',await evaluate(page,'JSON.stringify(chrome.runtime.getManifest().permissions)===JSON.stringify(["storage"]) && !chrome.runtime.getManifest().background'));
 console.log(`只读恢复器 ${count} 项通过，未连接用户真实同步账号。`);
}finally{page?.close();browser.kill()}
