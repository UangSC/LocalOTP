/* items 列表模块。 */
(function (global) {
  "use strict";
  global.OTP.createListItems = function ({ st, setActiveById, issuerText } = {}) {
    const OTP = global.OTP;
    const { el, icon } = OTP;
    const ui = OTP.ui;
    function buildRow(account) {
      const ring = OTP.ui.createRing({ period: account.period });
      const isPage = document.body.dataset.surface === "page";

      const emailNode = el("span", { class: "row-email truncate", text: account.email || account.issuer || "未命名 OTP" });
      const issuerNode = el("span", { class: "row-issuer truncate", text: issuerText(account) });

      const tools = buildTools(account);
      const codeNode = el("span", { class: "code", text: "· · ·" });

      const node = el(
        "div",
        {
          class: "item row",
          tabindex: "0",
          role: "button",
          dataset: { id: account.id },
          "aria-label": (account.email || account.issuer || "未命名 OTP") + "，点击复制验证码",
        },
        OTP.avatar(account),
        el(
          "span",
          { class: "row-main" },
          emailNode,
          el(
            "span",
            { class: "row-sub" },
            // 宽屏是表格：服务名贴着列首，复制入口和时间放在同一列右侧
            isPage
              ? [
                  issuerNode,
                  account.period !== 30
                    ? el("span", { class: "period-chip", text: account.period + "s" })
                    : null,
                  tools.node,
                  el("span", {
                    class: "row-time",
                    text: "更新于 " + OTP.fmt.relativeText(account.updatedAt || account.createdAt),
                  }),
                ]
              : [
                  tools.node,
                  issuerNode,
                  account.period !== 30
                    ? el("span", { class: "period-chip", text: account.period + "s" })
                    : null,
                ]
          )
        ),
        el("span", { class: "row-side" }, codeNode, ring.node)
      );

      // 宽屏行末的「更多」：右键菜单之外的一条可发现路径
      if (isPage) {
        node.append(
          el("button", {
            class: "ibtn ibtn-sm row-more",
            type: "button",
            "aria-label": "更多操作",
            "data-tip": "更多（右键亦可）",
            html: icon("more", 15),
            onclick: (event) => {
              event.stopPropagation();
              st.actions.menu(account, node, event);
            },
            onpointerdown: (event) => event.stopPropagation(),
          })
        );
      }

      bindItem(node, account);
      return { node, emailNode, issuerNode, codeNode, ring, tools, kind: "row" };
    }

    /* ── 弹窗：快速复制行 ─────────────────────────────────────────────────── */

    /**
     * 一行 = 身份 + 三枚复制键。
     * 验证码那枚占满剩余宽度并带浅品牌底：小窗口里 90% 的操作就是复制它。
     */
    function buildQuick(account) {
      const ring = OTP.ui.createRing({ period: account.period, cls: "ring-sm" });

      const emailNode = el("span", { class: "row-email truncate", text: account.email || account.issuer || "未命名 OTP" });
      const issuerNode = el("span", { class: "row-issuer truncate", text: issuerText(account) });
      const codeNode = el("span", { class: "code", text: "· · ·" });
      const codeIco = el("span", { class: "qact-ico", html: icon("copy", 13) });

      let emailBtn;
      let passBtn;

      const codeBtn = el(
        "button",
        {
          class: "qact qact-code",
          type: "button",
          "aria-label": (account.email || account.issuer || "未命名 OTP") + "，复制验证码",
          "data-tip": "复制验证码",
          onclick: async (event) => {
            event.stopPropagation();
            const ok = await st.actions.copyCode(account, node, event);
            if (ok) doneFlash(codeBtn, codeIco, "copy");
          },
          onpointerdown: (event) => event.stopPropagation(),
        },
        codeNode,
        codeIco
      );

      emailBtn = quickButton("mail", "邮箱", (event) =>
        handleFieldCopy(account, "email", emailBtn, event)
      );
      passBtn = quickButton("key", "密码", (event) =>
        handleFieldCopy(account, "password", passBtn, event)
      );

      emailBtn.hidden = !account.email;
      passBtn.hidden = !account.password;

      const pin = el("button", {
        class: "q-pin",
        type: "button",
        "aria-label": "聚焦锁定",
        "data-tip": "聚焦锁定 · F",
        html: icon("target", 14),
        onclick: (event) => {
          event.stopPropagation();
          if (st.actions.toggleFocus) st.actions.toggleFocus(account);
        },
        onpointerdown: (event) => event.stopPropagation(),
      });

      const node = el(
        "div",
        {
          class: "item quick",
          tabindex: "0",
          role: "button",
          dataset: { id: account.id },
          "aria-label": (account.email || account.issuer || "未命名 OTP") + "，单击复制验证码",
        },
        el(
          "div",
          { class: "q-top" },
          OTP.avatar(account),
          el("span", { class: "q-id" }, emailNode, issuerNode),
          pin,
          ring.node
        ),
        el("div", { class: "q-acts" }, emailBtn, passBtn, codeBtn)
      );

      bindItem(node, account);
      return { node, emailNode, issuerNode, codeNode, ring, pin, kind: "quick" };
    }

    function quickButton(iconName, label, handler) {
      return el(
        "button",
        {
          class: "qact",
          type: "button",
          "aria-label": "复制" + label,
          "data-tip": "复制" + label,
          onclick: (event) => {
            event.stopPropagation();
            handler(event);
          },
          onpointerdown: (event) => event.stopPropagation(),
        },
        el("span", { html: icon(iconName, 13) }),
        el("span", { text: label })
      );
    }

    /** 复制成功后把某枚按钮的图标换成勾，820ms 后还原 */
    function doneFlash(button, icoSpan, originalIcon) {
      button.classList.add("is-done");
      icoSpan.innerHTML = icon("check", 13);
      setTimeout(() => {
        button.classList.remove("is-done");
        icoSpan.innerHTML = icon(originalIcon, 13);
      }, 820);
    }

    /* ── 卡片 ─────────────────────────────────────────────────────────────── */

    function buildCard(account) {
      const ring = OTP.ui.createRing({ period: account.period, cls: "ring-sm" });

      const nameNode = el("span", { class: "card-name truncate", text: issuerText(account) });
      const emailNode = el("span", { class: "card-email truncate", text: account.email || account.issuer || "未命名 OTP" });
      const codeNode = el("span", { class: "code card-code", text: "· · ·" });
      const tools = buildTools(account, "card-tools");

      const node = el(
        "div",
        {
          class: "item card",
          tabindex: "0",
          role: "button",
          dataset: { id: account.id },
          "aria-label": (account.email || account.issuer || "未命名 OTP") + "，点击复制验证码",
        },
        el(
          "span",
          { class: "card-top" },
          OTP.avatar(account),
          nameNode,
          ring.node
        ),
        emailNode,
        codeNode,
        tools.node
      );

      bindItem(node, account);
      return { node, emailNode, issuerNode: nameNode, codeNode, ring, tools, kind: "card" };
    }

    /* ── 迷你复制按钮 ─────────────────────────────────────────────────────── */

    function buildTools(account, className) {
      const mail = miniButton("mail", "复制邮箱", (event) =>
        handleFieldCopy(account, "email", mail, event)
      );
      const key = miniButton("key", "复制密码", (event) =>
        handleFieldCopy(account, "password", key, event)
      );
      mail.hidden = !account.email;
      key.hidden = !account.password;
      const node = el("span", { class: className || "row-tools" }, mail, key);
      if (className === "card-tools") node.append(miniButton("more", "更多操作", (event) => {
        st.actions.menu(account, node.closest(".item"), event);
      }));
      return { node, mail, key };
    }

    function miniButton(iconName, tip, handler) {
      return el("button", {
        class: "mini",
        type: "button",
        "data-tip": tip,
        "aria-label": tip,
        html: icon(iconName, 13),
        onclick: (event) => {
          event.stopPropagation();
          event.preventDefault();
          handler(event);
        },
        onpointerdown: (event) => event.stopPropagation(),
        ondblclick: (event) => event.stopPropagation(),
      });
    }

    /** 复制邮箱 / 密码：成功后图标变勾、泛起品牌色，760ms 后还原 */
    async function handleFieldCopy(account, which, button, event) {
      if (button.classList.contains("is-done")) return;
      const value = which === "email" ? account.email : account.password;
      if (!value) {
        OTP.ui.toast(which === "email" ? "这条记录没有邮箱" : "这条记录没有密码", "warn");
        return;
      }
      const ok = await (st.actions.copyField
        ? st.actions.copyField(account, which)
        : OTP.copyText(value).then((done) => {
            if (done) OTP.ui.toast(which === "email" ? "已复制邮箱" : "已复制密码");
            else OTP.ui.toast("剪贴板写入失败", "bad");
            return done;
          }));

      if (!ok) return;

      // 保留原始内容再还原：这样同一段逻辑既能用于纯图标按钮（列表 / 卡片），
      // 也能用于带文字标签的按钮（弹窗里的「邮箱 / 密码」键）。
      const originalHTML = button.innerHTML;
      const originalTip = button.getAttribute("data-tip");
      const labelled = button.classList.contains("qact");

      button.classList.add("is-done");
      button.innerHTML = icon("check", 13, "i-sm") + (labelled ? "<span>已复制</span>" : "");
      button.setAttribute("data-tip", "已复制");
      if (event) OTP.ui.ripple(button, event);

      setTimeout(() => {
        button.classList.remove("is-done");
        button.innerHTML = originalHTML;
        if (originalTip) button.setAttribute("data-tip", originalTip);
        else button.removeAttribute("data-tip");
      }, 760);
    }

    /* ── 事件绑定 ─────────────────────────────────────────────────────────── */

    function bindItem(node, account) {
      let lightFrame = 0;
      node.addEventListener("pointermove", (event) => {
        if (OTP.reduceMotion() || event.pointerType === "touch" || lightFrame) return;
        const x = event.clientX, y = event.clientY;
        lightFrame = requestAnimationFrame(() => {
          lightFrame = 0;
          const rect = node.getBoundingClientRect();
          node.style.setProperty("--light-x", `${x - rect.left}px`);
          node.style.setProperty("--light-y", `${y - rect.top}px`);
        });
      }, { passive: true });
      node.addEventListener("pointerleave", () => {
        cancelAnimationFrame(lightFrame); lightFrame = 0;
        node.style.removeProperty("--light-x"); node.style.removeProperty("--light-y");
      });
      node.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        if (event.metaKey || event.ctrlKey) {
          st.actions.edit(account);
          return;
        }
        setActiveById(account.id, false);
        st.actions.copyCode(account, node, event);
      });

      node.addEventListener("dblclick", (event) => {
        if (event.target.closest("button")) return;
        st.actions.edit(account);
      });

      node.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        setActiveById(account.id, false);
        st.actions.menu(account, node, event);
      });

      node.addEventListener("keydown", (event) => {
        // 焦点在行内的按钮上时，Enter / 空格交给按钮自己处理，避免复制两次
        if (event.target.closest("button")) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          st.actions.copyCode(account, node, null);
        } else if (event.key === "e" || event.key === "E") {
          event.preventDefault();
          st.actions.edit(account);
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          st.actions.remove(account);
        }
      });
    }

    /* ── 倒计时调度 ───────────────────────────────────────────────────────── */


    return { buildRow, buildQuick, buildCard };
  };
})(globalThis);
