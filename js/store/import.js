/* import 数据规则。 */
(function (global) {
  "use strict";
  global.OTP.createAccountImporter = function ({ state, VERSION, persist, emit, normalizeAccount, byId } = {}) {
    const OTP = global.OTP;
    const { uid } = OTP;
    const totp = OTP.totp;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    /**
     * 支持两种行：
     *   1) 邮箱----密码----密钥
     *   2) otpauth://totp/...   （二维码内容）
     * 密码原样保留（可含 ----、空格、引号、$），首尾空白不裁剪。
     */
    function parseImport(text) {
      const source = String(text || "").replace(/^\uFEFF/, "");
      const lines = source.split(/\r?\n/);
      const rows = [];
      const seen = new Map();
      const existing = new Map(
        state.accounts.map((a) => [a.email.trim().toLowerCase(), a])
      );

      lines.forEach((raw, index) => {
        const line = raw.replace(/\s+$/, "");
        const lineNo = index + 1;
        if (!line.trim()) return;

        // ---- otpauth:// ----
        const otpIndex = line.toLowerCase().indexOf("otpauth://");
        if (otpIndex >= 0) {
          const parsed = totp.parseOtpauth(line.slice(otpIndex).trim());
          if (!parsed) {
            rows.push({ line: lineNo, kind: "bad", reason: "otpauth 链接无法解析" });
            return;
          }
          if (parsed.error) {
            rows.push({ line: lineNo, kind: "bad", reason: parsed.error });
            return;
          }
          const email = parsed.email || parsed.account || "";
          if (!email) {
            rows.push({ line: lineNo, kind: "bad", reason: "链接里没有邮箱或账号名" });
            return;
          }
          const key = email.toLowerCase();
          const dupOf = existing.get(key);
          const row = {
            line: lineNo,
            kind: dupOf ? "dup" : "new",
            email,
            password: "",
            secret: parsed.secret,
            issuer: parsed.issuer || parsed.account || "",
            note: "",
            categoryId: "",
            algorithm: parsed.algorithm,
            digits: parsed.digits,
            period: parsed.period,
            reason: dupOf ? "与已有账号重复" : "",
            dupOf: dupOf ? dupOf.id : null,
            fromUri: true,
          };
          if (seen.has(key)) {
            row.kind = "dup";
            row.reason = "同一批次内重复";
            row.dupOf = null;
          }
          seen.set(key, row);
          rows.push(row);
          return;
        }

        // ---- email----password----secret ----
        const first = line.indexOf("----");
        const last = line.lastIndexOf("----");
        if (first < 0 || last <= first) {
          rows.push({
            line: lineNo,
            kind: "bad",
            reason: first < 0 ? "缺少 ---- 分隔符" : "字段不足，需要 邮箱----密码----密钥",
          });
          return;
        }

        rows.push(
          classifyRow(
            lineNo,
            line.slice(0, first).trim(),
            line.slice(first + 4, last),
            line.slice(last + 4).trim(),
            seen,
            existing
          )
        );
      });

      return finishRows(rows);
    }

    /** 把一行的三个字段变成统一的行对象（含错误与重复判定） */
    function classifyRow(lineNo, emailRaw, password, secretRaw, seen, existing, extras) {
      const email = String(emailRaw || "").trim();
      if (!EMAIL_RE.test(email)) {
        return { line: lineNo, kind: "bad", reason: "邮箱格式不正确", email };
      }
      if (!password.length) {
        return { line: lineNo, kind: "bad", reason: "密码为空", email };
      }

      const check = totp.validateSecret(secretRaw);
      if (!check.ok) {
        return { line: lineNo, kind: "bad", reason: check.error, email };
      }

      const key = email.toLowerCase();
      const dupOf = existing.get(key);
      const extra = extras || {};
      const row = {
        line: lineNo,
        kind: dupOf ? "dup" : "new",
        email,
        password,
        secret: check.normalized,
        issuer: extra.issuer || "",
        note: "",
        categoryId: "",
        algorithm: extra.algorithm || "SHA1",
        digits: extra.digits || 6,
        period: extra.period || 30,
        reason: dupOf ? "与已有账号重复" : "",
        dupOf: dupOf ? dupOf.id : null,
        fromUri: !!extra.fromUri,
      };
      if (seen.has(key)) {
        row.kind = "dup";
        row.reason = "同一批次内重复";
        row.dupOf = null;
      }
      seen.set(key, row);
      return row;
    }

    function finishRows(rows) {
      const stats = {
        total: rows.length,
        fresh: rows.filter((r) => r.kind === "new").length,
        dup: rows.filter((r) => r.kind === "dup").length,
        bad: rows.filter((r) => r.kind === "bad").length,
      };
      const replaceable = rows.filter((r) => r.kind === "dup" && r.dupOf).length;
      return { rows, stats, replaceable };
    }

    /* ── 快速添加：一行搞定，容忍 -- / Tab / | 分隔 ───────────────────────── */

    /**
     * 小窗里的"快速添加"要的是手速，所以除规范写法外还接受几种常见分隔。
     * 注意取舍：用 `--` 分隔时，密码里不能再出现 `--`（那种情况请用 `----`）。
     */
    function splitQuick(line) {
      const firstDash = line.indexOf("----");
      if (firstDash >= 0) {
        const lastDash = line.lastIndexOf("----");
        if (lastDash > firstDash) {
          return [
            line.slice(0, firstDash),
            line.slice(firstDash + 4, lastDash),
            line.slice(lastDash + 4),
          ];
        }
      }
      if (line.includes("\t")) {
        const parts = line.split("\t");
        if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join("\t")];
      }
      if (line.includes("|")) {
        const parts = line.split("|");
        if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join("|")];
      }
      const segments = line.split("--");
      if (segments.length === 3) return segments;
      return null;
    }

    function parseQuick(text) {
      const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
      const rows = [];
      const seen = new Map();
      const existing = new Map(state.accounts.map((a) => [a.email.trim().toLowerCase(), a]));

      lines.forEach((raw, index) => {
        const line = raw.trim();
        if (!line) return;
        const parts = splitQuick(line);
        if (!parts) {
          rows.push({
            line: index + 1,
            kind: "bad",
            reason: "认不出分隔符：用 邮箱----密码----密钥，或 邮箱--密码--密钥",
          });
          return;
        }
        rows.push(classifyRow(index + 1, parts[0], parts[1], parts[2], seen, existing));
      });

      return finishRows(rows);
    }

    /**
     * 执行导入。
     * mode = skip | replace | keep（keep 表示重复项也作为独立账号插入）
     */
    function applyImport(rows, mode) {
      const m = mode === "replace" ? "replace" : mode === "keep" ? "keep" : "skip";
      let added = 0;
      let replaced = 0;

      for (const row of rows) {
        if (row.kind === "bad") continue;

        if (row.kind === "new" || (row.kind === "dup" && m === "keep")) {
          state.accounts.unshift(
            normalizeAccount({
              id: uid("acc_"),
              email: row.email,
              password: row.password || "",
              secret: row.secret,
              issuer: row.issuer || "",
              note: row.note || "",
              categoryId: row.categoryId || "",
              algorithm: row.algorithm,
              digits: row.digits,
              period: row.period,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
          );
          added += 1;
          continue;
        }

        if (row.kind === "dup" && m === "replace" && row.dupOf) {
          const target = byId(row.dupOf);
          if (target) {
            target.password = row.password || target.password;
            target.secret = row.secret || target.secret;
            if (row.issuer) target.issuer = row.issuer;
            target.algorithm = row.algorithm || target.algorithm;
            target.digits = row.digits || target.digits;
            target.period = row.period || target.period;
            target.updatedAt = Date.now();
            replaced += 1;
          }
        }
      }

      if (added || replaced) {
        persist();
        emit("account:import");
      }
      return { added, replaced };
    }

    /* ── 备份 ─────────────────────────────────────────────────────────────── */

    function exportPayload() {
      return {
        format: "localotp.backup",
        version: VERSION,
        exportedAt: new Date().toISOString(),
        app: "LocalOTP",
        categories: state.categories,
        accounts: state.accounts,
      };
    }

    /** 按邮箱合并恢复；不覆盖已有账号，除非 payload 里带 replace */
    function importPayload(payload) {
      if (!payload || typeof payload !== "object") throw new Error("备份文件格式不正确");
      if (!Array.isArray(payload.accounts)) throw new Error("备份里没有账号列表");

      const known = new Set(state.accounts.map((a) => a.email.toLowerCase()));
      const catMap = new Map();
      if (Array.isArray(payload.categories)) {
        for (const cat of payload.categories) {
          if (!cat || !cat.name) continue;
          catMap.set(cat.id, cat.name);
        }
      }
      const localCats = new Map(state.categories.map((c) => [c.name.toLowerCase(), c.id]));

      let added = 0;
      let skipped = 0;

      for (const raw of payload.accounts) {
        const account = normalizeAccount(raw);
        if (!account) {
          skipped += 1;
          continue;
        }
        const key = account.email.toLowerCase();
        if (known.has(key)) {
          skipped += 1;
          continue;
        }
        const check = totp.validateSecret(account.secret);
        if (!check.ok) {
          skipped += 1;
          continue;
        }
        // 把备份里的分类名映射到本地分类 id
        if (catMap.has(account.categoryId)) {
          const name = catMap.get(account.categoryId).toLowerCase();
          account.categoryId = localCats.get(name) || "";
        }
        known.add(key);
        state.accounts.push(account);
        added += 1;
      }

      if (added) {
        persist();
        emit("account:import");
      }
      return { added, skipped };
    }

    /* ── 统计 ─────────────────────────────────────────────────────────────── */


    return { parseImport, parseQuick, applyImport, exportPayload, importPayload };
  };
})(globalThis);
