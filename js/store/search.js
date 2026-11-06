/* search 数据规则。 */
(function (global) {
  "use strict";
  global.OTP.createAccountSearch = function ({ state, accounts } = {}) {
    const OTP = global.OTP;
    const list = OTP.list;
    function rangesOf(text, query) {
      const hay = String(text || "");
      const q = String(query || "");
      if (!q) return [];
      const lower = hay.toLowerCase();
      const target = q.toLowerCase();
      const out = [];
      let from = 0;
      for (;;) {
        const idx = lower.indexOf(target, from);
        if (idx < 0) break;
        out.push([idx, idx + target.length]);
        from = idx + target.length;
        if (out.length > 12) break;
      }
      return out;
    }

    function sortAccounts(list, sort) {
      const arr = list.slice();
      if (sort === "email") {
        arr.sort((a, b) => a.email.localeCompare(b.email, "zh-Hans-CN"));
      } else if (sort === "issuer") {
        arr.sort((a, b) => (a.issuer || "未命名").localeCompare(b.issuer || "未命名", "zh-Hans-CN"));
      } else {
        arr.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      }
      return arr;
    }

    /**
     * 检索。codes 是界面层算好的 id → 当前验证码映射，
     * 传进来才能支持"直接搜验证码数字"。
     */
    function search(query, options) {
      const o = options || {};
      const q = String(query == null ? "" : query).trim();
      const scope = o.categoryId;
      const list = accounts().filter((a) => {
        if (!scope) return true;
        if (scope === "__none__") return !a.categoryId;
        return a.categoryId === scope;
      });

      if (!q) {
        return { query: "", hits: [], total: list.length, empty: list.length === 0 };
      }

      const lower = q.toLowerCase();
      const digits = q.replace(/\s/g, "");
      const digitQuery = digits.length > 0 && /^\d+$/.test(digits);
      const codes = o.codes || null;

      const hits = [];
      for (const account of list) {
        const emailRanges = rangesOf(account.email, q);
        const issuerRanges = rangesOf(account.issuer, q);
        const noteRanges = rangesOf(account.note, q);

        let codeRanges = [];
        if (digitQuery && codes && codes.get(account.id)) {
          codeRanges = rangesOf(codes.get(account.id), digits);
        }

        const matched =
          emailRanges.length ||
          issuerRanges.length ||
          noteRanges.length ||
          codeRanges.length ||
          (lower && `${account.email} ${account.issuer} ${account.note}`.toLowerCase().includes(lower));

        if (matched) {
          hits.push({
            account,
            ranges: { email: emailRanges, issuer: issuerRanges, note: noteRanges, code: codeRanges },
          });
        }
      }
      return { query: q, hits, total: list.length, empty: false };
    }

    /* ── 导入解析 ─────────────────────────────────────────────────────────── */


    return { sortAccounts, search };
  };
})(globalThis);
