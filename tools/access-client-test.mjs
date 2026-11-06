import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function client(responder) {
  let changed; const sent=[];
  const context={OTP:{store:{settings:()=>({rememberMinutes:0})}},crypto:{randomUUID:()=> '11111111-2222-4333-8444-555555555555'},
    chrome:{runtime:{id:'test',sendMessage:async message=>{sent.push(message);return responder(message)}},storage:{session:{},onChanged:{addListener:fn=>{changed=fn}}}}};
  vm.createContext(context);vm.runInContext(readFileSync('js/access.js','utf8'),context);
  return {api:context.OTP.access,sent,change:(oldValue,newValue)=>changed({'localotp:access:v1':{oldValue,newValue}},'session')};
}
await test('工具栏页面每次请求携带同一随机标识，另一个页面不能靠标识获得 proof',async()=>{
  const c=client(m=>m.action==='unlock'?{ok:true,proof:'verified',epoch:'new'}:{ok:true});
  await c.api.unlock('sample');await c.api.float();
  assert.equal(c.sent[0].clientId,c.sent[1].clientId);assert.equal(c.sent[1].proof,'verified');
});
await test('延迟到达的本次授权 epoch 通知不能清除刚收到的 proof',async()=>{
  const c=client(m=>m.action==='unlock'?{ok:true,proof:'verified',epoch:'new'}:{ok:true});
  let revoked=0;c.api.onRevoked(()=>revoked++);
  await c.api.unlock('sample');c.change({epoch:'old'},{epoch:'new'});await c.api.float();
  assert.equal(c.sent.at(-1).proof,'verified');assert.equal(revoked,0);
  c.change({epoch:'new'},{epoch:'revoked'});await c.api.float();
  assert.equal(c.sent.at(-1).proof,'');assert.equal(revoked,1);
});
await test('窗口创建错误保留真实原因，不伪装成未解锁',async()=>{
  const c=client(()=>({ok:false,code:'WINDOW_CREATE_FAILED',error:'浏览器未能创建独立窗口'}));
  await assert.rejects(c.api.float(),/未能创建独立窗口/);
});
await test('后台缺失响应与身份错误不被当成密码错误',async()=>{
  const missing=client(()=>undefined);await assert.rejects(missing.api.unlock('sample'),/后台未响应/);
  const denied=client(()=>({ok:false,code:'INVALID_CONTEXT',error:'无法识别当前扩展页面'}));await assert.rejects(denied.api.unlock('sample'),/无法识别/);
});
