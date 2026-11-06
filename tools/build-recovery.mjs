/* 在用户确认的旧加载目录创建只读恢复器；不覆盖现有目录，不改变主扩展身份。 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined};
const output=option('--output'),expected=option('--expected-id');
if(!output || !expected || !/^[a-p]{32}$/.test(expected)) throw new Error('用法：node tools/build-recovery.mjs --output 旧加载目录 --expected-id 旧扩展ID');
const target=resolve(output);
if(existsSync(target)) throw new Error('目标目录已存在，拒绝覆盖：'+target);
if(!existsSync(dirname(target))) throw new Error('目标父目录不存在');
mkdirSync(target);
cpSync(join(root,'tools/recovery'),target,{recursive:true});
mkdirSync(join(target,'js'));
for(const name of ['util.js','totp.js','sync.js'])cpSync(join(root,'js',name),join(target,'js',name));
writeFileSync(join(target,'expected-id.js'),'globalThis.expectedExtensionId='+JSON.stringify(expected)+';\n');
console.log('只读恢复器：'+target+'\n预期旧 ID：'+expected);
