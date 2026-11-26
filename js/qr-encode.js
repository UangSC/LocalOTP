/* ==========================================================================
   LocalOTP · qr-encode
   纯前端离线 QR Code 编码器（ISO/IEC 18004，UTF-8 Byte 模式，版本 1–40，纠错等级 M）。
   零网络依赖，输出布尔矩阵或高清晰度 PNG/SVG Data URL（含标准 4 模块白色静区）。
   ========================================================================== */

(function (global) {
  "use strict";

  const OTP = global.OTP || (global.OTP = {});

  /* ── 纠错等级 M 参数表（版本 1–40）：[每块纠错码字数, 组1块数, 组1数据码字数, 组2块数, 组2数据码字数] ── */
  const EC_M = [
    null,
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51],
    [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38],
    [24, 4, 40, 5, 41],
    [24, 5, 41, 5, 42],
    [28, 7, 45, 3, 46],
    [28, 10, 46, 1, 47],
    [26, 9, 43, 4, 44],
    [26, 3, 44, 11, 45],
    [26, 3, 41, 13, 42],
    [26, 17, 42, 0, 0],
    [28, 17, 46, 0, 0],
    [28, 4, 47, 14, 48],
    [28, 6, 45, 14, 46],
    [28, 8, 47, 13, 48],
    [28, 19, 46, 4, 47],
    [28, 22, 45, 3, 46],
    [28, 3, 45, 23, 46],
    [28, 21, 45, 7, 46],
    [28, 19, 47, 10, 48],
    [28, 2, 46, 29, 47],
    [28, 10, 46, 23, 47],
    [28, 14, 46, 21, 47],
    [28, 14, 46, 23, 47],
    [28, 12, 47, 26, 48],
    [28, 6, 47, 34, 48],
    [28, 29, 46, 14, 47],
    [28, 13, 46, 32, 47],
    [28, 40, 47, 7, 48],
    [28, 18, 47, 31, 48],
  ];

  /* 对齐图形中心坐标（版本 2–40） */
  const ALIGN_POS = [
    [],
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170],
  ];

  /* ── GF(256) 与 Reed-Solomon 纠错 ─────────────────────────────────────── */

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsGenerator(degree) {
    const coeffs = new Uint8Array(degree);
    coeffs[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        coeffs[j] = gfMul(coeffs[j], root);
        if (j + 1 < degree) coeffs[j] ^= coeffs[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return coeffs;
  }

  function rsRemainder(data, gen) {
    const result = new Uint8Array(gen.length);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let j = 0; j < gen.length; j++) {
        result[j] ^= gfMul(gen[j], factor);
      }
    }
    return result;
  }

  /* ── 比特流与数据编码 ──────────────────────────────────────────────────── */

  function pickVersion(byteLen) {
    for (let ver = 1; ver <= 40; ver++) {
      const [, g1c, g1d, g2c, g2d] = EC_M[ver];
      const totalDataBytes = g1c * g1d + g2c * g2d;
      const countBits = ver <= 9 ? 8 : 16;
      const neededBits = 4 + countBits + byteLen * 8;
      if (neededBits <= totalDataBytes * 8) return ver;
    }
    throw new Error("OTP 链接过长，无法编码为二维码");
  }

  function buildCodewords(bytes, version) {
    const [ecPerBlock, g1Count, g1Data, g2Count, g2Data] = EC_M[version];
    const totalDataBytes = g1Count * g1Data + g2Count * g2Data;
    const totalDataBits = totalDataBytes * 8;

    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    // Byte mode indicator (0100) + character count
    pushBits(0b0100, 4);
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);

    // Terminator (up to 4 zero bits)
    const termLen = Math.min(4, totalDataBits - bits.length);
    pushBits(0, termLen);

    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    // Pack to bytes & alternate pad bytes 0xEC, 0x11
    const dataBytes = new Uint8Array(totalDataBytes);
    const filled = bits.length / 8;
    for (let i = 0; i < filled; i++) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
      dataBytes[i] = b;
    }
    for (let i = filled, pad = 0; i < totalDataBytes; i++, pad ^= 1) {
      dataBytes[i] = pad === 0 ? 0xec : 0x11;
    }

    // Split into RS blocks and compute EC codewords
    const gen = rsGenerator(ecPerBlock);
    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    const totalBlocks = g1Count + g2Count;
    for (let b = 0; b < totalBlocks; b++) {
      const len = b < g1Count ? g1Data : g2Data;
      const slice = dataBytes.subarray(offset, offset + len);
      offset += len;
      dataBlocks.push(slice);
      ecBlocks.push(rsRemainder(slice, gen));
    }

    // Interleave data codewords, then EC codewords
    const out = [];
    const maxDataLen = Math.max(g1Data, g2Data);
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < totalBlocks; b++) {
        if (i < dataBlocks[b].length) out.push(dataBlocks[b][i]);
      }
    }
    for (let i = 0; i < ecPerBlock; i++) {
      for (let b = 0; b < totalBlocks; b++) {
        out.push(ecBlocks[b][i]);
      }
    }
    return new Uint8Array(out);
  }

  /* ── 矩阵构造与掩码评估 ────────────────────────────────────────────────── */

  function createMatrix(version, codewords) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    const setFunc = (x, y, dark) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = dark ? 1 : 0;
      isFunc[y][x] = 1;
    };

    // Timing patterns
    for (let i = 0; i < size; i++) {
      setFunc(6, i, i % 2 === 0);
      setFunc(i, 6, i % 2 === 0);
    }

    // Finder patterns + separators
    const drawFinder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunc(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    };
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    // Alignment patterns
    const pos = ALIGN_POS[version];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        if (
          (i === 0 && j === 0) ||
          (i === 0 && j === pos.length - 1) ||
          (i === pos.length - 1 && j === 0)
        ) continue;
        const cx = pos[i], cy = pos[j];
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFunc(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    // Reserve format info & dark module
    drawFormatBits(modules, isFunc, size, 0);
    // Reserve version info (version >= 7)
    if (version >= 7) drawVersionBits(modules, isFunc, size, version);

    // Place data bits in zigzag columns
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunc[y][x] && bitIdx < totalBits) {
            modules[y][x] = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
        }
      }
    }

    // Evaluate all 8 masks and pick lowest penalty
    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(modules, isFunc, size, mask);
      drawFormatBits(modules, isFunc, size, mask);
      const p = penaltyScore(modules, size);
      if (p < bestPenalty) {
        bestPenalty = p;
        bestMask = mask;
      }
      applyMask(modules, isFunc, size, mask); // undo
    }
    applyMask(modules, isFunc, size, bestMask);
    drawFormatBits(modules, isFunc, size, bestMask);
    return modules;
  }

  function drawFormatBits(modules, isFunc, size, mask) {
    // EC level M = 00 (2 bits) + 3-bit mask
    const data = (0b00 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    const set = (x, y, val) => {
      modules[y][x] = val;
      isFunc[y][x] = 1;
    };

    for (let i = 0; i <= 5; i++) set(8, i, (bits >>> i) & 1);
    set(8, 7, (bits >>> 6) & 1);
    set(8, 8, (bits >>> 7) & 1);
    set(7, 8, (bits >>> 8) & 1);
    for (let i = 9; i < 15; i++) set(14 - i, 8, (bits >>> i) & 1);

    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, (bits >>> i) & 1);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, (bits >>> i) & 1);
    set(8, size - 8, 1); // dark module
  }

  function drawVersionBits(modules, isFunc, size, version) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = (bits >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      modules[b][a] = dark; isFunc[b][a] = 1;
      modules[a][b] = dark; isFunc[a][b] = 1;
    }
  }

  function applyMask(modules, isFunc, size, mask) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunc[y][x]) continue;
        let invert = false;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) modules[y][x] ^= 1;
      }
    }
  }

  function penaltyScore(modules, size) {
    let score = 0;
    // Rule 1: adjacent same-color runs
    for (let y = 0; y < size; y++) {
      let runColor = modules[y][0], runLen = 1;
      for (let x = 1; x < size; x++) {
        if (modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runColor = modules[y][x];
          runLen = 1;
        }
      }
    }
    for (let x = 0; x < size; x++) {
      let runColor = modules[0][x], runLen = 1;
      for (let y = 1; y < size; y++) {
        if (modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runColor = modules[y][x];
          runLen = 1;
        }
      }
    }
    // Rule 2: 2x2 blocks
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          score += 3;
        }
      }
    }
    // Rule 3: finder-like patterns 1:1:3:1:1 with 4 light modules on either side
    const matchFinder = (get, len) => {
      let hits = 0;
      for (let i = 0; i <= len - 11; i++) {
        const p1 = get(i) === 1 && get(i + 1) === 0 && get(i + 2) === 1 && get(i + 3) === 1 &&
          get(i + 4) === 1 && get(i + 5) === 0 && get(i + 6) === 1 &&
          get(i + 7) === 0 && get(i + 8) === 0 && get(i + 9) === 0 && get(i + 10) === 0;
        const p2 = get(i) === 0 && get(i + 1) === 0 && get(i + 2) === 0 && get(i + 3) === 0 &&
          get(i + 4) === 1 && get(i + 5) === 0 && get(i + 6) === 1 &&
          get(i + 7) === 1 && get(i + 8) === 1 && get(i + 9) === 0 && get(i + 10) === 1;
        if (p1 || p2) hits++;
      }
      return hits * 40;
    };
    for (let y = 0; y < size; y++) score += matchFinder((x) => modules[y][x], size);
    for (let x = 0; x < size; x++) score += matchFinder((y) => modules[y][x], size);

    // Rule 4: dark ratio balance
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += modules[y][x];
    const total = size * size;
    const k = Math.floor(Math.abs(dark * 20 - total * 10) / total);
    score += k * 10;
    return score;
  }

  /* ── 对外接口 ──────────────────────────────────────────────────────────── */

  function encodeMatrix(text) {
    const bytes = new TextEncoder().encode(String(text || ""));
    if (!bytes.length) throw new Error("二维码内容不能为空");
    const version = pickVersion(bytes.length);
    const codewords = buildCodewords(bytes, version);
    return createMatrix(version, codewords);
  }

  function toPngDataUrl(text, opts) {
    const o = opts || {};
    const matrix = Array.isArray(text) ? text : encodeMatrix(text);
    const n = matrix.length;
    const quiet = o.quiet == null ? 4 : o.quiet;
    const targetSize = o.size || 320;
    const totalModules = n + quiet * 2;
    const scale = Math.max(4, Math.floor(targetSize / totalModules));
    const px = totalModules * scale;

    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = o.light || "#ffffff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = o.dark || "#0f172a";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (matrix[y][x]) {
          ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    }
    return canvas.toDataURL("image/png");
  }

  function toSvgDataUrl(text, opts) {
    const o = opts || {};
    const matrix = Array.isArray(text) ? text : encodeMatrix(text);
    const n = matrix.length;
    const quiet = o.quiet == null ? 4 : o.quiet;
    const dim = n + quiet * 2;
    const dark = o.dark || "#0f172a";
    const light = o.light || "#ffffff";
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (matrix[y][x]) d += `M${x + quiet},${y + quiet}h1v1h-1z`;
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  OTP.qrEncode = {
    encodeMatrix,
    toPngDataUrl,
    toSvgDataUrl,
  };
})(globalThis);
