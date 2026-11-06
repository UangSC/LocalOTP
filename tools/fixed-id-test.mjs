/* 同一公钥在两个不同路径的隔离 Edge 中实际加载，防止发布时误换扩展身份。 */
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createBrowserProfile, cleanProfileOnExit, findBrowser, sleep } from './cdp.mjs';

const EXPECTED_ID = 'mjpifhendkddjgmoheglnfciammaipji';
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const der = Buffer.from(manifest.key || '', 'base64');
const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
assert.equal(key.asymmetricKeyType, 'rsa');
assert.equal(key.asymmetricKeyDetails.modulusLength, 2048);
const derived = createHash('sha256').update(der).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, char => String.fromCharCode(97 + parseInt(char, 16)));
assert.equal(derived, EXPECTED_ID, '公钥被改变，扩展 ID 将与既有发布不一致');

async function verify(label, port) {
  const profile = createBrowserProfile('fixed-id-' + label + '-');
  const directory = join(profile, 'extension-' + label); mkdirSync(directory);
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'LocalOTP ID verification', version: '1.0.0', key: manifest.key, background: { service_worker: 'probe.js' } }));
  writeFileSync(join(directory, 'probe.js'), 'globalThis.ready=true;');
  const child = spawn(findBrowser(), ['--headless=new', '--no-first-run', '--disable-sync', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${directory}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cleanProfileOnExit(child, profile);
  try {
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      let targets;
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { continue; }
      const worker = targets.find(target => target.url.endsWith('/probe.js'));
      if (!worker) continue;
      assert.equal(new URL(worker.url).hostname, EXPECTED_ID);
      return { directory: label, id: EXPECTED_ID };
    }
    throw new Error('测试扩展加载超时');
  } finally { child.kill(); }
}
const results = await Promise.all([verify('A', 9411), verify('B', 9412)]);
console.log('公钥格式、固定 ID 及两个不同目录的真实 Edge 加载均通过。');
console.log(JSON.stringify(results));
