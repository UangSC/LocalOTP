/* 批量导入表单。 */
(function (global) {
  "use strict";
  const OTP = global.OTP, store = OTP.store, ui = OTP.ui;
  const { el, icon } = OTP;
  const { field, statChip, changed } = OTP.sheetUI;
  const importState = {
    rows: [],
    mode: "skip",
    text: "",
  };

  function importPane() {
    const textarea = el("textarea", {
      class: "imp-input",
      spellcheck: false,
      placeholder: OTP.seed.SAMPLE_IMPORT.split("\n")[0] + "\n也支持粘贴 otpauth:// 链接",
      value: importState.text,
    });

    const dropzone = el("div", { class: "dropzone" }, textarea);

    const fileInput = el("input", { type: "file", accept: ".txt,text/plain", hidden: true });

    const scanCard = el(
      "button",
      {
        id: "imp-open-scan",
        class: "scan-source imp-source",
        type: "button",
        onclick: () => OTP.scan.open(),
      },
      el("span", { html: icon("scan", 20) }),
      el("b", { text: "扫码与截图" }),
      el("small", { text: "网页框选 · 图片 · OTP 链接" })
    );

    const fileCard = el(
      "button",
      {
        id: "imp-pick-file",
        class: "scan-source imp-source",
        type: "button",
        onclick: () => fileInput.click(),
      },
      el("span", { html: icon("file", 20) }),
      el("b", { text: "选择文本文件" }),
      el("small", { text: "读取 .txt 或拖入下方" })
    );

    const sampleBtn = el("button", {
      class: "btn btn-ghost btn-xs",
      type: "button",
      text: "填入示例",
      onclick: () => {
        textarea.value = OTP.seed.SAMPLE_IMPORT;
        parse();
      },
    });

    const clearBtn = el("button", {
      class: "btn btn-ghost btn-xs",
      type: "button",
      text: "清空",
      onclick: () => {
        textarea.value = "";
        parse();
        textarea.focus();
      },
    });

    const sizeLabel = el("span", { class: "h", text: "0 行" });

    const totalStat = statChip("共", "0", "行");
    const freshStat = statChip("可新增", "0", "");
    const dupStat = statChip("重复", "0", "");
    const badStat = statChip("无效", "0", "");

    const previewList = el("div", { class: "imp-list" });
    const copyErrors = el("button", {
      class: "lnk",
      type: "button",
      text: "复制错误清单",
      onclick: copyErrorList,
    });

    const dupSeg = ui.segmented({
      active: importState.mode,
      className: "seg-sm",
      items: [
        { id: "skip", label: "跳过" },
        { id: "replace", label: "替换" },
        { id: "keep", label: "保留" },
      ],
      onChange: (id) => {
        importState.mode = id;
        renderImport();
      },
    });

    const doImportBtn = el("button", {
      class: "btn btn-primary",
      type: "button",
      text: "导入记录",
      disabled: true,
      onclick: runImport,
    });

    function parse() {
      importState.text = textarea.value;
      const result = store.parseImport(textarea.value);
      importState.rows = result.rows;
      importState.stats = result.stats;
      importState.replaceable = result.replaceable;
      renderImport();
    }

    function renderImport() {
      const rows = importState.rows;
      const stats = importState.stats || { total: 0, fresh: 0, dup: 0, bad: 0 };

      if (totalStat.value) totalStat.value.textContent = String(stats.total);
      freshStat.value.textContent = String(stats.fresh);
      dupStat.value.textContent = String(stats.dup);
      badStat.value.textContent = String(stats.bad);
      sizeLabel.textContent = rows.length + " 行";

      const mode = importState.mode;
      const count =
        mode === "replace"
          ? stats.fresh + (importState.replaceable || 0)
          : mode === "keep"
            ? stats.fresh + stats.dup
            : stats.fresh;

      doImportBtn.disabled = count === 0;
      doImportBtn.textContent = count ? `导入 ${count} 条记录` : "导入记录";

      OTP.clear(previewList);

      if (!rows.length) {
        previewList.append(
          el("div", {
            class: "field-hint",
            style: { "text-align": "center", padding: "14px 0" },
            text: "粘贴数据后会自动解析预览",
          })
        );
        return;
      }

      const shown = rows.slice(0, 80);
      shown.forEach((row, index) => {
        const cls = row.kind === "bad" ? "is-bad" : row.kind === "dup" ? "is-dup" : "";
        const statusClass = row.kind === "bad" ? "is-bad" : row.kind === "dup" ? "is-dup" : "is-ok";
        const statusText = row.kind === "bad" ? "无效" : row.kind === "dup" ? "重复" : "新增";
        const label = row.email || row.issuer || "未命名 OTP";
        const primary = row.kind === "bad" ? row.reason : label + (row.reason ? " · " + row.reason : "");

        const item = el(
          "div",
          { class: "imp-item " + cls, style: { "animation-delay": Math.min(index, 12) * 14 + "ms" } },
          el("span", { class: "ln", text: String(row.line) }),
          el("div", { class: "em", text: primary }),
          el("span", { class: "st " + statusClass, text: statusText })
        );
        previewList.append(item);
      });

      if (rows.length > shown.length) {
        previewList.append(
          el("div", {
            class: "field-hint",
            style: { "text-align": "center", padding: "6px 0" },
            text: `仅预览前 ${shown.length} 行，共 ${rows.length} 行`,
          })
        );
      }
    }

    async function copyErrorList() {
      const bad = importState.rows.filter((row) => row.kind === "bad");
      if (!bad.length) {
        ui.toast("没有无效记录", "warn");
        return;
      }
      const text = bad.map((row) => `第 ${row.line} 行：${row.reason}`).join("\n");
      const ok = await OTP.copyText(text);
      ui.toast(ok ? `已复制 ${bad.length} 条错误说明` : "复制失败", ok ? "ok" : "bad");
    }

    function runImport() {
      const result = store.applyImport(importState.rows, importState.mode);
      if (!result.added && !result.replaced) {
        ui.toast("没有可导入的记录", "warn");
        return;
      }
      textarea.value = "";
      importState.rows = [];
      importState.text = "";
      parse();
      changed("import");
      ui.toast(
        `已导入 ${result.added} 条` + (result.replaced ? `，替换 ${result.replaced} 条` : "")
      );
    }

    textarea.addEventListener("input", OTP.debounce(parse, 200));

    // 拖放文件
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("is-over");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-over"));
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-over");
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) readFile(file);
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) readFile(file);
      fileInput.value = "";
    });

    function readFile(file) {
      if (file.size > 1024 * 1024) {
        ui.toast("文件超过 1 MiB，请拆分后再导入", "bad");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        textarea.value = String(reader.result || "").replace(/^\uFEFF/, "");
        parse();
        ui.toast("已读入文件");
      };
      reader.readAsText(file, "utf-8");
    }

    const body = el(
      "div",
      { class: "imp-pane" },
      el("div", { class: "imp-sources" }, scanCard, fileCard),
      el(
        "div",
        { class: "card-box imp-editor-box" },
        el(
          "div",
          { class: "card-head" },
          el("span", { class: "t", text: "批量粘贴" }),
          el("span", { class: "h", text: "邮箱----密码----密钥 / otpauth://" })
        ),
        dropzone,
        el("div", { class: "row-btns" }, sampleBtn, clearBtn, el("span", { class: "spacer" }), sizeLabel),
        fileInput
      ),
      el(
        "div",
        { class: "card-box imp-preview-box" },
        el(
          "div",
          { class: "card-head" },
          el("span", { class: "t", text: "解析预览" }),
          copyErrors
        ),
        el("div", { class: "imp-stats" }, totalStat.node, freshStat.node, dupStat.node, badStat.node),
        previewList
      )
    );

    const footer = el(
      "div",
      { class: "imp-footer" },
      el(
        "div",
        { class: "imp-dup-ctl" },
        el("span", { class: "imp-dup-label", text: "重复项" }),
        dupSeg.node
      ),
      doImportBtn
    );

    parse();

    return { body, footer, dispose: () => dupSeg.destroy() };
  }


  Object.assign(OTP.sheetParts, { importPane });
})(globalThis);
