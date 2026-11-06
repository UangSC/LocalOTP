/* gate 应用控制器。 */
(function (global) {
  "use strict";
  global.OTP.createGateController = function ({ els, runtime, surface, applyTheme, renderAll } = {}) {
    const OTP = global.OTP;
    const { el, icon, clear } = OTP;
    const store = OTP.store, ui = OTP.ui, list = OTP.list, totp = OTP.totp;
    function buildLock(mode) {
      const isCreate = mode === "create";

      const mark = el("div", {
        class: "lock-mark",
        html: icon("shield", 29, "i-lg"),
      });

      const title = el("h1", { text: isCreate ? "先设一个管理密码" : "LocalOTP" });
      const sub = el("p", {
        class: "lock-sub",
        text: isCreate ? "默认验证后 15 分钟内重开免密，可在设置中调整" : "输入管理密码，解锁本地验证码库",
      });

      const firstWrap = pwWrap(isCreate ? "设置管理密码（至少 4 位）" : "管理密码", "lock");
      const secondWrap = isCreate ? pwWrap("再次输入确认", "lock2") : null;

      const errorLine = el("p", { class: "lock-err", role: "alert" });
      const strength = isCreate ? buildStrength() : null;

      const submitBtn = el("button", {
        class: "btn btn-primary btn-block",
        type: "submit",
        text: isCreate ? "创建并进入" : "解锁",
      });

      const cooldown = el("p", { class: "lock-cool", hidden: true });

      const form = el(
        "form",
        { class: "lock-form", autocomplete: "off" },
        firstWrap.node,
        secondWrap ? secondWrap.node : null,
        strength ? strength.node : null,
        errorLine,
        cooldown,
        submitBtn
      );

      const footLinks = el(
        "div",
        { class: "lock-foot-links" },
        el("button", {
          type: "button",
          text: "查看快捷键",
          onclick: () =>
            ui.confirm({
              title: "键盘快捷键",
              message:
                "<b>/</b> 或 <b>Ctrl / ⌘ K</b> 搜索 · <b>上下键</b> 定位 · <b>Enter</b> 复制验证码" +
                "<br><b>N</b> 新增 · <b>Q</b> 快速添加 · <b>F</b> 聚焦锁定 · <b>I</b> 导入 · <b>L</b> 锁定 · <b>Esc</b> 关闭",
              confirmText: "知道了",
              icon: "gauge",
            }),
        }),
        el("span", { class: "sep" }),
        el("button", {
          type: "button",
          text: "清空本机数据",
          onclick: async () => {
            const ok = await ui.confirm({
              title: "清空本机数据？",
              message: "账号、分类与管理密码都会被删除。若还记得密码，请先解锁后导出备份。",
              confirmText: "全部清空",
              danger: true,
              icon: "trash",
            });
            if (!ok) return;
            await store.wipe();
            applyTheme(false);
            rebuildLock("create");
          },
        })
      );

      const node = el(
        "section",
        { class: "lock", "aria-label": isCreate ? "设置管理密码" : "解锁" },
        el(
          "div",
          { class: "lock-card" },
          mark,
          title,
          sub,
          form,
          footLinks,
          el(
            "div",
            { class: "lock-foot" },
            el("span", { html: icon("lock", 12) }),
            el("span", {
              text: isCreate
                ? "密码只作界面门禁，不会加密存储中的密码与密钥"
                : "管理密码只用于界面解锁 · 同步按设置启用",
            })
          )
        )
      );

      if (isCreate) {
        firstWrap.input.addEventListener("input", () => strength.update(firstWrap.input.value));
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (runtime.submitting || runtime.transitioning || Date.now() < runtime.cooldownUntil) return;
        runtime.submitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = isCreate ? "正在创建…" : "正在解锁…";
        try {
          if (isCreate) await submitCreate(firstWrap, secondWrap, errorLine, submitBtn, node);
          else await submitUnlock(firstWrap, errorLine, node);
        } catch (err) {
          fail(errorLine, firstWrap, err.message || "操作失败，请重试");
        } finally {
          runtime.submitting = false;
          submitBtn.disabled = Date.now() < runtime.cooldownUntil;
          if (!submitBtn.disabled) submitBtn.textContent = isCreate ? "创建并进入" : "解锁";
        }
      });

      return node;
    }

    function pwWrap(placeholder, id) {
      const input = el("input", {
        id: "pw-" + id,
        type: "password",
        placeholder,
        autocomplete: id === "lock" ? "current-password" : "new-password",
        "aria-label": placeholder,
      });

      const eye = el("button", {
        class: "eye",
        type: "button",
        "aria-label": "显示密码",
        html: icon("eye", 16, "i-sm"),
        onclick: () => {
          const show = input.type === "password";
          input.type = show ? "text" : "password";
          eye.innerHTML = icon(show ? "eye-off" : "eye", 16, "i-sm");
          input.focus();
        },
      });

      const node = el(
        "label",
        { class: "pw-wrap" },
        el("span", { html: icon("lock", 16) }),
        input,
        eye
      );

      return { node, input };
    }

    function buildStrength() {
      const bars = el("div", { class: "strength-bars" }, el("i"), el("i"), el("i"));
      const label = el("span", { class: "strength-label", text: "" });
      const node = el("div", { class: "strength", dataset: { level: "0" } }, bars, label);

      return {
        node,
        update(value) {
          let score = 0;
          if (value.length >= 4) score += 1;
          if (value.length >= 8) score += 1;
          if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
          if (/\d/.test(value)) score += 1;
          if (/[^\w\s]/.test(value)) score += 1;
          const level = value ? Math.min(3, Math.max(1, Math.round(score * 0.6))) : 0;
          node.dataset.level = String(level);
          label.textContent = level === 0 ? "" : level === 1 ? "弱" : level === 2 ? "中" : "强";
        },
      };
    }

    async function submitCreate(first, second, errorLine, button, lockNode) {
      const a = first.input.value;
      const b = second.input.value;

      if (a.length < 4) {
        fail(errorLine, first, "密码至少 4 位");
        return;
      }
      if (a !== b) {
        fail(errorLine, second, "两次输入不一致");
        return;
      }

      button.disabled = true;
      button.textContent = "正在生成摘要…";
      await store.setPassword(a);
      let authorized = false, authorizationError = "密码已保存，但后台授权未完成，请重新解锁";
      try { authorized = await OTP.access.unlock(a); } catch (error) { authorizationError = error.message; }
      if (!authorized) {
        rebuildLock("unlock", false);
        const message = runtime.lockNode.querySelector(".lock-err");
        message.textContent = authorizationError;
        message.classList.add("is-show");
        return;
      }
      button.textContent = "创建并进入";
      await markEntered(lockNode);
    }

    async function submitUnlock(first, errorLine, lockNode) {
      const value = first.input.value;
      if (!value) {
        fail(errorLine, first, "请输入管理密码");
        return;
      }

      const ok = await OTP.access.unlock(value);
      if (ok) {
        runtime.failCount = 0;
        await markEntered(lockNode);
        return;
      }

      runtime.failCount += 1;
      const left = 5 - runtime.failCount;
      fail(
        errorLine,
        first,
        left > 0 && left <= 2 ? `密码不正确，还可以再试 ${left} 次` : "密码不正确，请重试"
      );
      first.input.select();

      if (runtime.failCount >= 5) startCooldown(lockNode);
    }

    function fail(errorLine, wrap, message) {
      errorLine.innerHTML = icon("alert-circle", 12) + "<span></span>";
      errorLine.querySelector("span").textContent = message;
      errorLine.classList.add("is-show");
      wrap.node.classList.remove("is-bad");
      void wrap.node.offsetWidth;
      wrap.node.classList.add("is-bad");
    }

    function startCooldown(lockNode) {
      runtime.cooldownUntil = Date.now() + 20000;
      runtime.failCount = 0;

      const inputs = lockNode.querySelectorAll(".pw-wrap input");
      const button = lockNode.querySelector(".btn-primary");
      const label = lockNode.querySelector(".lock-cool");

      inputs.forEach((input) => (input.disabled = true));
      button.disabled = true;
      label.hidden = false;

      clearInterval(runtime.cooldownTimer);
      const tick = () => {
        const left = Math.ceil((runtime.cooldownUntil - Date.now()) / 1000);
        if (left <= 0) {
          clearInterval(runtime.cooldownTimer);
          inputs.forEach((input) => (input.disabled = false));
          button.disabled = false;
          button.textContent = "解锁";
          label.hidden = true;
          inputs[0].focus();
          return;
        }
        label.textContent = `尝试次数过多，请 ${left} 秒后再试`;
        button.textContent = `等待 ${left}s`;
      };
      tick();
      runtime.cooldownTimer = setInterval(tick, 250);
    }

    function rebuildLock(mode, animate = true) {
      clearInterval(runtime.cooldownTimer);
      if (runtime.lockNode) runtime.lockNode.remove();

      const node = buildLock(mode);
      runtime.lockNode = node;
      els.app.append(node);
      node.style.opacity = animate ? "0" : "1";
      if (!animate) node.querySelector(".lock-card").style.animation = "none";

      // 管理页：标记"上锁"，让页面骨架先不出现（只剩环境光 + 那张卡片）
      if (surface === "page") document.body.dataset.locked = "1";

      // 用局部引用而不是 runtime.lockNode：解锁/导航可能在下一帧之前就把它清掉了
      if (!animate) return;
      requestAnimationFrame(() => {
        if (!node.isConnected) return;
        node.style.opacity = "";
        const input = node.querySelector("input");
        if (input) {
          setTimeout(() => {
            if (node.isConnected) input.focus();
          }, 120);
        }
      });
    }

    function setContentInert(value) {
      els.screen.inert = value;
      const sidebar = els.app.querySelector(".sidebar");
      if (sidebar) sidebar.inert = value;
    }

    async function markEntered(lockNode) {
      if (runtime.transitioning || runtime.lockNode !== lockNode) return;
      runtime.transitioning = true;
      lockNode.inert = true;
      runtime.lastActivity = Date.now();
      els.screen.classList.add("is-in");
      try {
        renderAll({ stagger: false });
        await list.refreshAll();
        await OTP.gateMotion.transition({ app: els.app, lock: lockNode, entering: true });
      } finally {
        lockNode.remove();
        runtime.lockNode = null;
        runtime.transitioning = false;
        document.body.dataset.locked = "";
        setContentInert(false);
        (els.searchInput || els.pageSearch)?.focus({ preventScroll: true });
      }
    }

    async function lock({ revoke = true } = {}) {
      if (runtime.lockNode || runtime.transitioning) return;
      runtime.transitioning = true;
      if (revoke && store.settings().passwordRequired === false) {
        store.patchSettings({ passwordRequired: true });
        try { await store.persist(); }
        catch (_) { runtime.transitioning = false; ui.toast("恢复密码验证失败，请重试", "bad"); return; }
        ui.toast("已恢复密码验证");
      }
      runtime.transitioning = true;
      setContentInert(true);
      if (revoke) OTP.access.revoke().catch(() => ui.toast("会话清理失败，请关闭浏览器后重新打开", "bad"));
      ui.closeAll();
      runtime.quickOtp?.clear();
      OTP.totp.clearKeyCache();
      list.cancelMotion();
      list.stopTicker();
      rebuildLock(store.hasPassword() ? "unlock" : "create", false);
      const node = runtime.lockNode;
      node.inert = true;
      try {
        await OTP.gateMotion.transition({ app: els.app, lock: node, entering: false });
      } finally {
        els.screen.classList.remove("is-in");
        runtime.transitioning = false;
        node.inert = false;
        node.querySelector("input")?.focus({ preventScroll: true });
      }
    }

    function relockAfterWipe() {
      OTP.access.revoke().catch(() => {});
      runtime.quickOtp?.clear();
      els.screen.classList.remove("is-in");
      setContentInert(true);
      rebuildLock("create");
    }

    /* 渲染 */


    return { rebuildLock, setContentInert, lock, relockAfterWipe };
  };
})(globalThis);
