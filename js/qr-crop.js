/* 当前页面中的全屏截图蒙版。Shadow DOM 隔离站点样式，不缩放文本界面。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  OTP.scanTheme = () => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ["surface", "ink", "ink-2", "brand", "brand-ink", "line", "on-brand"].map((key) => [
        key,
        style.getPropertyValue("--" + key).trim(),
      ]),
    );
  };
  OTP.cropQr = async function (blob, { theme = {}, signal } = {}) {
    const source = await OTP.qr.bitmap(blob);
    if (signal?.aborted) {
      source.close();
      return null;
    }
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.id = "localotp-crop-host";
      const root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        :host { all: initial; } * { box-sizing: border-box; }
        dialog { position:fixed;inset:0;margin:0;padding:0;border:0;max-width:none;max-height:none;width:100vw;height:100vh;background:#141a2b;overflow:hidden;color:var(--ink);font:14px/1.5 system-ui,sans-serif;cursor:default; }
        dialog::backdrop { background:transparent; }
        .stage { position:absolute;inset:0;display:flex;align-items:center;justify-content:center; }
        .board { position:relative;line-height:0;touch-action:none;cursor:crosshair; }
        canvas { display:block;max-width:100vw;max-height:100vh;width:auto;height:auto; }
        .shade { position:absolute;inset:0;background:#0006;pointer-events:none; }
        .box { position:absolute;border:2px solid var(--brand);box-shadow:0 0 0 9999px #0006;pointer-events:none; }
        [hidden] { display:none!important; }
        .toolbar { position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 16px;box-shadow:0 8px 28px #0003;max-width:calc(100vw - 24px);line-height:1.5; }
        header { top:16px;pointer-events:none; } footer { bottom:16px; }
        p { margin:0;font-size:13px;color:var(--ink-2); } strong { white-space:nowrap; }
        button { font:inherit;white-space:nowrap;padding:9px 14px;border-radius:9px;cursor:pointer;background:transparent;color:var(--ink);border:1px solid var(--line); }
        button.primary { background:var(--brand);border-color:var(--brand);color:var(--on-brand,#fff); }
        button:disabled { opacity:.45;cursor:default; } button:focus-visible { outline:2px solid var(--brand);outline-offset:3px; }
        @media(max-width:500px) { header { width:calc(100vw - 24px);flex-wrap:wrap;gap:3px!important; } footer { gap:6px!important; } button { padding:8px 10px; } }
      `;
      const make = (tag, text, cls) => {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (cls) node.className = cls;
        return node;
      };
      const dialog = make("dialog");
      dialog.setAttribute("aria-label", "框选网页二维码");
      const defaults = {
        surface: "#fff",
        ink: "#263749",
        "ink-2": "#526273",
        brand: "#2563eb",
        "brand-ink": "#2563eb",
        line: "#dce5ef",
        "on-brand": "#fff",
      };
      for (const [key, value] of Object.entries(defaults))
        dialog.style.setProperty("--" + key, theme[key] || value);
      const canvas = make("canvas");
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext("2d").drawImage(source, 0, 0);
      const box = make("div", "", "box");
      box.hidden = true;
      const shade = make("div", "", "shade");
      const board = make("div", "", "board");
      board.append(canvas, shade, box);
      const stage = make("div", "", "stage");
      stage.append(board);
      const header = make("header", "", "toolbar"),
        hint = make("p", "拖动框选 QR 区域，保留四周留白 · Esc 取消");
      header.append(make("strong", "框选二维码"), hint);
      const cancel = make("button", "取消"),
        whole = make("button", "识别整图"),
        confirm = make("button", "识别选区", "primary");
      confirm.disabled = true;
      const footer = make("footer", "", "toolbar");
      footer.append(cancel, whole, confirm);
      dialog.append(stage, header, footer);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(style.textContent);
      root.adoptedStyleSheets = [sheet];
      root.append(dialog);
      let start = null,
        region = null,
        done = false;
      const point = (event) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
          y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
        };
      };
      board.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        start = point(event);
        region = null;
        confirm.disabled = true;
        box.hidden = true;
        shade.hidden = false;
        board.setPointerCapture(event.pointerId);
      });
      board.addEventListener("pointermove", (event) => {
        if (!start) return;
        const end = point(event),
          x = Math.min(start.x, end.x),
          y = Math.min(start.y, end.y),
          w = Math.abs(start.x - end.x),
          h = Math.abs(start.y - end.y);
        Object.assign(box.style, {
          left: x * 100 + "%",
          top: y * 100 + "%",
          width: w * 100 + "%",
          height: h * 100 + "%",
        });
        box.hidden = false;
        shade.hidden = true;
        region = {
          x: Math.floor(x * source.width),
          y: Math.floor(y * source.height),
          w: Math.max(1, Math.round(w * source.width)),
          h: Math.max(1, Math.round(h * source.height)),
        };
      });
      board.addEventListener("pointerup", () => {
        start = null;
        confirm.disabled = !region || region.w < 20 || region.h < 20;
        hint.textContent = confirm.disabled ? "请框选完整二维码" : "已选中区域 · 可重新拖动调整，或点击识别";
      });
      board.addEventListener("pointercancel", () => {
        start = null;
        region = null;
        box.hidden = true;
        shade.hidden = false;
        confirm.disabled = true;
      });
      const abort = () => finish(null);
      async function finish(rect) {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", abort);
        let result = null;
        if (rect) {
          const output = document.createElement("canvas");
          output.width = rect.w;
          output.height = rect.h;
          output.getContext("2d").drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
          result = await new Promise((done) => output.toBlob(done, "image/png"));
          output.width = output.height = 0;
        }
        source.close();
        canvas.width = canvas.height = 0;
        dialog.close();
        host.remove();
        resolve(signal?.aborted ? null : result);
      }
      cancel.onclick = abort;
      whole.onclick = () => finish({ x: 0, y: 0, w: source.width, h: source.height });
      confirm.onclick = () => finish(region);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        abort();
      });
      dialog.addEventListener("keydown", (event) => event.stopPropagation());
      signal?.addEventListener("abort", abort, { once: true });
      document.documentElement.append(host);
      dialog.showModal();
    });
  };
})(globalThis);
