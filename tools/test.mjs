/* 统一测试入口；浏览器用例顺序执行，避免动画和固定调试端口互相干扰。 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suites = [
  ["tools/check-project.mjs"],
  ["tools/selftest.mjs"],
  ["tools/sync-test.mjs"],
  ["--test", "tools/access-test.mjs", "tools/access-client-test.mjs", "tools/otp-core-test.mjs", "tools/version-test.mjs"],
  ["tools/extension-test.mjs"],
  ["tools/sync-isolation-test.mjs"],
  ["tools/fixed-id-test.mjs"],
  ["tools/management-page-test.mjs"],
  ["tools/popup-context-test.mjs", "--open-page"],
  ["tools/popup-context-test.mjs", "--deny-unlock", "--open-page"],
  ["tools/window-browser-test.mjs"],
  ["tools/otp-browser-test.mjs"],
  ["tools/qa.mjs"],
  ["tools/category-icons-test.mjs"],
  ["tools/scan-access-browser-test.mjs"],
  ["tools/scan-capture-browser-test.mjs"],
  ["tools/ui-polish-test.mjs"],
  ["tools/popup-layout-test.mjs"],
  ["tools/popup-sizing-test.mjs"],
  ["tools/popup-native-size-test.mjs"],
  ["tools/management-interaction-test.mjs"],
];
for (const args of suites) {
  console.log("运行：node " + args.join(" "));
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error("测试失败：" + args.join(" "));
    process.exit(result.status || 1);
  }
}
console.log(`${suites.length} 组检查与测试全部通过。`);
