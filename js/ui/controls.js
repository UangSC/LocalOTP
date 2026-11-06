/* controls 通用界面控件。 */
(function (global) {
  "use strict";
  global.OTP.createUIControls = function ({  } = {}) {
    const OTP = global.OTP;
    const { el, icon, clamp } = OTP;
    const list = OTP.list;
    const SVG_NS = "http://www.w3.org/2000/svg";

    function circle(cls, r) {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("class", cls);
      c.setAttribute("cx", "20");
      c.setAttribute("cy", "20");
      c.setAttribute("r", String(r));
      c.setAttribute("pathLength", "100");
      return c;
    }

    /**
     * 三层环：轨道 / 光晕 / 进度。
     * paint() 可以在 rAF 里高频调用 —— 只有数值真的变了才写 DOM。
     */
    function createRing(opts) {
      const o = opts || {};
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 40 40");
      svg.setAttribute("aria-hidden", "true");

      const track = circle("ring-track", 16.6);
      const glow = circle("ring-glow", 16.6);
      const bar = circle("ring-bar", 16.6);
      for (const node of [glow, bar]) {
        node.setAttribute("stroke-dasharray", "100");
        node.setAttribute("stroke-dashoffset", "0");
      }
      svg.append(track, glow, bar);

      const num = el("b", { class: "ring-num", text: String(o.period || 30) });
      const node = el("span", {
        class: o.cls ? "ring " + o.cls : "ring",
        dataset: { state: "calm" },
      });
      node.append(svg, num);

      // 呼吸动画的相位统一从墙钟推出来：凡是在同一毫秒创建的环、
      // 或者后续重渲染新建的环，都会落在同一个呼吸相位上，不会各pulse各的。
      node.style.setProperty("--pulse-delay", `-${Date.now() % 1150}ms`);

      let lastOffset = null;
      let lastSeconds = -1;
      let lastState = "";
      let snapTimer = 0;

      return {
        node,
        /**
         * 两种喂法：
         *   paint({ seconds, period })  → 弧长严格等于"显示的那个整数秒"，和数字永远一致
         *   paint({ progress })         → 直接给 0..1（编辑抽屉里的实时预览用）
         */
        paint(state) {
          let offset;
          if (typeof state.seconds === "number") {
            const period = state.period || o.period || 30;
            offset = 100 - (clamp(state.seconds, 0, period) / period) * 100;
          } else {
            offset = 100 - clamp(state.progress, 0, 1) * 100;
          }
          offset = Math.round(clamp(offset, 0, 100) * 10) / 10;

          // 跨周期时要"瞬切"回满格，而不是反向扫一圈
          if (state.snap) {
            node.classList.add("is-snap");
            clearTimeout(snapTimer);
            snapTimer = setTimeout(() => node.classList.remove("is-snap"), 60);
          }

          if (offset !== lastOffset) {
            bar.setAttribute("stroke-dashoffset", String(offset));
            glow.setAttribute("stroke-dashoffset", String(offset));
            lastOffset = offset;
          }
          if (state.seconds !== undefined && state.seconds !== lastSeconds) {
            num.textContent = String(state.seconds);
            lastSeconds = state.seconds;
          }
          if (state.state !== lastState) {
            node.dataset.state = state.state;
            lastState = state.state;
          }
        },
        setPeriod(period) {
          num.textContent = String(period);
        },
        destroy() {
          clearTimeout(snapTimer);
          node.remove();
        },
      };
    }

    /* ── 滑动开关（列表 ⇄ 卡片）──────────────────────────────────────────── */

    /**
     * 一个可以"推"的开关：拖动滑块到另一边就切换，点一下也能切，
     * 键盘 ← → / 空格 / 回车同样管用。
     */
    function swipeSwitch(opts) {
      const o = opts || {};
      const items = o.items || [];
      const onChange = o.onChange;
      const node = el("div", {
        class: "sw-switch",
        role: "group",
        "aria-label": o.label || "切换视图",
      });
      const track = el("span", { class: "sw-track" });
      const thumb = el("span", { class: "sw-thumb" });
      const icos = items.map((it) =>
        el("button", { class: "sw-ico", type: "button", "aria-label": it.id === "list" ? "列表视图" : "卡片视图", html: icon(it.icon, 16), dataset: { id: it.id }, onclick: () => set(it.id, true) })
      );
      track.append(...icos, thumb);
      node.append(track);

      let value = o.value || items[0].id;
      const indexOf = (v) => {
        const i = items.findIndex((it) => it.id === v);
        return i < 0 ? 0 : i;
      };
      const maxPx = () => track.clientWidth / 2;

      function place(px, animate) {
        thumb.classList.toggle("is-instant", !animate);
        thumb.style.setProperty("--x", px + "px");
        if (!animate) requestAnimationFrame(() => thumb.classList.remove("is-instant"));
      }

      function sync(animate) {
        const idx = indexOf(value);
        place(idx * maxPx(), animate);
        for (const ico of icos) {
          ico.classList.toggle("is-on", ico.dataset.id === value);
          ico.setAttribute("aria-pressed", String(ico.dataset.id === value));
        }
        node.dataset.value = value;

      }

      function set(next, animate) {
        if (!items.some((it) => it.id === next)) return value;
        if (next === value) {
          sync(animate);
          return value;
        }
        value = next;
        sync(animate);
        if (onChange) onChange(value);
        return value;
      }

      node.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          set(items[0].id, true);
          icos[0].focus();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          set(items[items.length - 1].id, true);
          icos[items.length - 1].focus();
        }
      });

      if (typeof ResizeObserver === "function") {
        new ResizeObserver(() => sync(false)).observe(track);
      }
      requestAnimationFrame(() => sync(false));

      return {
        node,
        sync: () => sync(false),
        set: (next) => set(next, true),
        /** 外部直接改值（不触发 onChange），用于回填设置 */
        update(next) {
          if (!items.some((it) => it.id === next)) return value;
          value = next;
          sync(false);
          return value;
        },
        get value() {
          return value;
        },
      };
    }

    /* ── 分段控件 ─────────────────────────────────────────────────────────── */

    /**
     * items: [{ id, label, icon?, count? }]
     * 返回 { node, setActive(id) }，滑块位置通过测量真实宽度得出，
     * 因此按钮文字长短不一也能严丝合缝。
     */
    function segmented(opts) {
      const o = opts || {};
      const pill = el("span", { class: "seg-pill", "aria-hidden": "true" });
      const node = el("div", { class: "seg" + (o.className ? " " + o.className : ""), role: "tablist" }, pill);
      const buttons = [];
      let active = o.active || (o.items[0] && o.items[0].id);

      for (const item of o.items || []) {
        const btn = el("button", {
          class: "seg-btn",
          type: "button",
          role: "tab",
          dataset: { id: item.id },
          "aria-selected": String(item.id === active),
          text: item.label,
          onclick: () => {
            if (item.id === active) return;
            setActive(item.id);
            if (o.onChange) o.onChange(item.id);
          },
        });
        buttons.push(btn);
        node.append(btn);
      }

      function place() {
        const btn = buttons.find((b) => b.dataset.id === active);
        if (!btn || !btn.offsetWidth) return;
        pill.style.width = btn.offsetWidth + "px";
        pill.style.transform = `translateX(${btn.offsetLeft - 3}px)`;
      }

      function setActive(id) {
        active = id;
        for (const btn of buttons) {
          const on = btn.dataset.id === id;
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-selected", String(on));
        }
        place();
      }

      setActive(active);
      requestAnimationFrame(place);
      return { node, setActive, get value() { return active; } };
    }

    /* ── Escape / 浮层状态 ────────────────────────────────────────────────── */


    return { createRing, swipeSwitch, segmented };
  };
})(globalThis);
