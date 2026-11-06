/* 只生成仓库中的公开测试夹具，从不读取浏览器配置或用户账号。 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function base32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
const batch = randomBytes(4).toString("hex");
const services = ["Demo Source", "Demo Review", "Demo Mail", "Demo Arcade", "Demo Notes", "Demo Design", "Demo Cloud", "Demo Recovery", "Demo Chat", "Demo Studio"];
const categories = ["cat_dev", "cat_dev", "cat_cloud", "cat_play", "cat_work", "cat_work", "cat_cloud", "cat_bank", "cat_play", "cat_work"];
function record(index) {
  return { email: `demo-${batch}-${String(index + 1).padStart(2, "0")}@example.invalid`,
    password: "PUBLIC-DEMO-" + randomBytes(9).toString("base64url") + "!",
    secret: base32(randomBytes(20)), issuer: services[index] || "Demo Import", categoryId: categories[index] || "",
    note: "公开演示数据，不对应真实账号；密码和密钥禁止用于真实服务。",
    algorithm: index === 5 ? "SHA256" : index === 9 ? "SHA512" : "SHA1",
    digits: index === 5 ? 8 : 6, period: index === 6 ? 60 : 30 };
}
const data = { batch, accounts: Array.from({ length: 10 }, (_, i) => record(i)), imports: [record(10), record(11), record(12)] };
const seedFile = resolve(root, "js/seed.js");
const source = readFileSync(seedFile, "utf8");
const marker = /  \/\/ demo-data:start[\s\S]*?  \/\/ demo-data:end/;
if (!marker.test(source)) throw new Error("未找到演示数据边界，已停止写入");
writeFileSync(seedFile, source.replace(marker, "  // demo-data:start\n  const DEMO = " + JSON.stringify(data, null, 2).split("\n").join("\n  ") + ";\n  // demo-data:end"));
const examples = resolve(root, "docs/examples"); mkdirSync(examples, { recursive: true });
writeFileSync(resolve(examples, "sync-test.txt"), data.accounts.slice(0, 5).map(a => `${a.email}----${a.password}----${a.secret}`).join("\n") + "\n");
console.log(`已重新生成批次 ${batch}：10 条演示账号、3 条导入示例、5 条双机测试数据；全部为公开虚构数据。`);
