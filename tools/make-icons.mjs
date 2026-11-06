#!/usr/bin/env node
/* ==========================================================================
   LocalOTP · 图标生成器
   --------------------------------------------------------------------------
   纯 Node 实现（只用内置 zlib），不依赖 Pillow / canvas / 任何外部包。

   图形：CPAMP 蓝圆角方块 + 白色盾牌 + 挖空的勾
   做法：4× 超采样覆盖度光栅化 → PNG（RGBA8）

   用法：node tools/make-icons.mjs [--preview]
   ========================================================================== */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "assets", "icons");

/* ── PNG 编码 ──────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── 几何 ──────────────────────────────────────────────────────────────── */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** 圆角矩形有符号距离（<0 在内部） */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}

/** 三次贝塞尔取点 */
function cubic(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** 24×24 网格 → 归一化坐标 */
const g = (x, y) => [x / 24, y / 24];

const SHIELD = (() => {
  const pts = [];
  // 顶边：从顶部中点到左上角
  pts.push(g(12, 2.6));
  pts.push(g(7.4, 4.5));
  pts.push(g(4.6, 5.8));
  // 左边直下
  pts.push(g(4.6, 11.4));
  // 左下 → 底部中点（三次贝塞尔）
  const p0 = g(4.6, 11.4);
  const p1 = g(4.6, 16.1);
  const p2 = g(7.65, 19.75);
  const p3 = g(12, 21.5);
  for (let i = 1; i <= 26; i++) pts.push(cubic(p0, p1, p2, p3, i / 26));
  // 底部中点 → 右下（镜像）
  const m = (p) => [1 - p[0], p[1]];
  for (let i = 26; i >= 1; i--) pts.push(m(cubic(p0, p1, p2, p3, i / 26)));
  pts.push(g(19.4, 11.4));
  pts.push(g(19.4, 5.8));
  pts.push(g(16.6, 4.5));
  return pts;
})();

/** 射线法判断点是否在多边形内 */
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 点到线段的距离 */
function segDist(px, py, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const len2 = vx * vx + vy * vy || 1e-9;
  const t = clamp((wx * vx + wy * vy) / len2, 0, 1);
  return Math.hypot(px - (a[0] + vx * t), py - (a[1] + vy * t));
}

const CHECK = [g(8.95, 12.1), g(11.1, 14.2), g(15.15, 9.85)];
const CHECK_HALF = 1.62 / 24; // 24 网格线宽 1.62 → 半宽

/* ── 渲染 ──────────────────────────────────────────────────────────────── */

const BRAND_A = [0x25, 0x63, 0xeb]; // #2563EB
const BRAND_B = [0x25, 0x63, 0xeb]; // 与默认实心按钮一致

function render(size) {
  const SS = 4; // 超采样倍数
  const N = size * SS;
  const rgba = Buffer.alloc(size * size * 4);

  // 每个子像素累加颜色与覆盖度
  const acc = new Float32Array(N * N * 4);

  const cx = N / 2;
  const cy = N / 2;
  const half = N / 2;
  const radius = N * 0.225;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = (x + 0.5) / N;
      const py = (y + 0.5) / N;

      const d = sdRoundRect(x + 0.5, y + 0.5, cx, cy, half, half, radius);
      const shape = clamp(0.5 - d, 0, 1); // 边缘 1px 抗锯齿
      if (shape <= 0) continue;

      // 背景渐变：145° 方向
      const t = clamp((px * 0.72 + py * 0.61) / 1.06, 0, 1);
      let r = lerp(BRAND_A[0], BRAND_B[0], t);
      let gg = lerp(BRAND_A[1], BRAND_B[1], t);
      let b = lerp(BRAND_A[2], BRAND_B[2], t);

      // 顶部内高光：让方块有厚度
      const sheen = clamp((0.46 - py) / 0.46, 0, 1) ** 1.7 * 0.28;
      r = lerp(r, 255, sheen);
      gg = lerp(gg, 255, sheen);
      b = lerp(b, 255, sheen);

      // 盾牌
      if (inPoly(px, py, SHIELD)) {
        const onCheck =
          Math.min(segDist(px, py, CHECK[0], CHECK[1]), segDist(px, py, CHECK[1], CHECK[2])) <
          CHECK_HALF;
        if (!onCheck) {
          r = 255;
          gg = 255;
          b = 255;
        }
      }

      const o = (y * N + x) * 4;
      acc[o] = r * shape;
      acc[o + 1] = gg * shape;
      acc[o + 2] = b * shape;
      acc[o + 3] = 255 * shape;
    }
  }

  // 降采样
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let gg = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * N + (x * SS + sx)) * 4;
          r += acc[o];
          gg += acc[o + 1];
          b += acc[o + 2];
          a += acc[o + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const alpha = a / n;
      // 未预乘 → 直通
      rgba[o] = alpha > 0 ? clamp(Math.round(r / n / (alpha / 255)), 0, 255) : 0;
      rgba[o + 1] = alpha > 0 ? clamp(Math.round(gg / n / (alpha / 255)), 0, 255) : 0;
      rgba[o + 2] = alpha > 0 ? clamp(Math.round(b / n / (alpha / 255)), 0, 255) : 0;
      rgba[o + 3] = clamp(Math.round(alpha), 0, 255);
    }
  }

  return encodePNG(size, size, rgba);
}

/* ── 主流程 ────────────────────────────────────────────────────────────── */

const SIZES = [16, 32, 48, 128];
mkdirSync(OUT, { recursive: true });

for (const size of SIZES) {
  const png = render(size);
  const file = join(OUT, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`✓ ${file}  (${png.length} B)`);
}

console.log("\n图标已生成：CPAMP 蓝 + 白色盾牌勾。");
