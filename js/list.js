/* ==========================================================================
   LocalOTP · list
   列表 / 卡片渲染、倒计时调度、搜索聚光、键盘活动项、复制回执。
   ========================================================================== */

(function (global) {
  "use strict";

  const OTP = global.OTP;
  const { el, icon } = OTP;

  const st = {
    container: null,
    viewport: null,
    actions: {},
    refs: new Map(),
    order: [],
    activeIdx: -1,
    query: "",
    hitIds: [],
    filtered: false,
    rafId: 0,
    emptyNode: null,
    noMatchNode: null,
    categoryId: "",
    firstPaint: true,
    running: false,
    focusId: null,
  };

  /* ── 挂载 ─────────────────────────────────────────────────────────────── */

  function mount(opts) {
    st.container = opts.container;
    st.viewport = opts.viewport || opts.container.parentElement;
    st.actions = opts.actions || {};

    st.container.addEventListener("scroll", updateEdges, { passive: true });

    // 用户一旦自己滚，就松开自动定位，别抢方向盘
    const cancel = () => OTP.cancelScroll();
    st.container.addEventListener("wheel", cancel, { passive: true });
    st.container.addEventListener("touchstart", cancel, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearTimeout(st.rafId); st.rafId = 0; }
      else if (st.running) { refreshAll(); scheduleTick(); }
    });
    global.addEventListener("focus", () => { if (st.running) refreshAll(); });
  }

  /* ── 渲染 ─────────────────────────────────────────────────────────────── */

  function currentAccounts() {
    const settings = OTP.store.settings();
    let list = OTP.store.accounts();
    if (st.categoryId === "__none__") list = list.filter((a) => !a.categoryId);
    else if (st.categoryId) list = list.filter((a) => a.categoryId === st.categoryId);
    return OTP.store.sortAccounts(list, settings.sort);
  }

  function render(opts) {
    const o = opts || {};
    const surface = document.body.dataset.surface === "page" ? "page" : "popup";
    const wanted = OTP.store.settings().view === "grid" ? "grid" : "list";
    // 弹窗永远是"快速复制行"：紧凑、三枚复制键，不提供卡片视图切换
    const view = surface === "page" ? wanted : "quick";
    const list = currentAccounts();

    const previous = st.refs;
    st.refs = new Map();
    const activeId = st.order[st.activeIdx];
    st.order = [];
    removeEmpty();
    hideNoMatch();

    st.container.dataset.view = view;

    if (!list.length) {
      OTP.clear(st.container);
      showEmpty();
      stopTicker();
      updateEdges();
      return 0;
    }

    list.forEach((account, index) => {
      const signature = JSON.stringify(account);
      let ref = previous.get(account.id);
      const cached = ref?.signature === signature ? ref : null;
      const kind = view === "list" ? "row" : view === "grid" ? "card" : "quick";
      if (!ref || ref.kind !== kind || ref.signature !== signature) {
        ref = view === "quick" ? buildQuick(account) : view === "grid" ? buildCard(account) : buildRow(account);
        Object.assign(ref, { acc: account, signature, counter: -1, code: "", shownSeconds: -1,
          placed: false, visible: true, hit: false, hlSig: "" });
        if (cached?.code) {
          ref.code = cached.code;
          ref.counter = cached.counter;
          ref.codeNode.textContent = OTP.fmt.group(cached.code);
        }
      }
      st.refs.set(account.id, ref);
      st.order.push(account.id);
      const current = st.container.children[index];
      if (current !== ref.node) st.container.insertBefore(ref.node, current || null);
    });
    for (const old of previous.values()) if (st.refs.get(old.acc.id) !== old) old.node.remove();
    st.activeIdx = activeId ? st.order.indexOf(activeId) : -1;

    if (o.stagger) reveal();

    refreshAll(false);
    startTicker();
    updateEdges();

    if (st.query) applySearch(st.query, { scroll: false });

    // 聚焦锁定跨渲染保留；目标不在了就自动解除
    if (st.focusId && !st.refs.has(st.focusId)) st.focusId = null;
    if (st.focusId) applyFocus();

    st.firstPaint = false;
    return list.length;
  }

  /* 有限数量的可见项参与动效，取消时同步清除旧快照和状态。 */
  const motionAnimations = new Set();
  const motionLayers = new Set();
  function trackMotion(node, frames, options) {
    const animation = node.animate(frames, { fill: "both", ...options });
    motionAnimations.add(animation);
    node.dataset.motion = "active";
    animation.finished.catch(() => {}).finally(() => {
      motionAnimations.delete(animation);
      animation.cancel();
      if (!node.getAnimations().some(a => motionAnimations.has(a))) delete node.dataset.motion;
    });
    return animation;
  }
  function cancelMotion() {
    for (const animation of motionAnimations) animation.cancel();
    motionAnimations.clear();
    for (const layer of motionLayers) layer.remove();
    motionLayers.clear();
    st.refs.forEach(ref => delete ref.node.dataset.motion);
  }
  function visibleItems() {
    const viewport = st.viewport.getBoundingClientRect();
    return [...st.refs.values()].map(ref => ({ ref, rect: ref.node.getBoundingClientRect() }))
      .filter(({rect}) => rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right)
      .slice(0, 24);
  }
  function reveal(options = {}) {
    if (OTP.reduceMotion() || document.hidden || !st.container.animate) return;
    cancelMotion();
    const items = visibleItems();
    return items.map(({ref}, index) => {
      return trackMotion(ref.node, [
        { opacity: .001, transform: "translateY(22px)" },
        { opacity: 1, transform: "translateY(-3px)", offset: .76 },
        { opacity: 1, transform: "none" },
      ], { duration: options.duration || 480, delay: (options.delay || 0) + Math.min(index, 12) * (options.step || 28), easing: "cubic-bezier(.16,1,.3,1)" });
    });
  }
  function prepareMotion() {
    const nodes = visibleItems().map(({ref}) => ref.node);
    nodes.forEach(node => { node.style.willChange = "transform, opacity"; });
    return () => nodes.forEach(node => { node.style.willChange = ""; });
  }
  function transitionLayout(commit) {
    cancelMotion();
    if (OTP.reduceMotion() || document.hidden || !st.container.animate) { commit(); return; }
    const before = visibleItems();
    const positions = new Map(before.map(({ref, rect}) => [ref.acc.id, rect]));
    const viewport = st.viewport.getBoundingClientRect();
    const layer = el("div", { class: "layout-ghost", "aria-hidden": "true", inert: true });
    // 只复制可见项作为 180ms 离场快照，不复制输入框或全量账号库。
    for (const {ref, rect} of before) {
      const ghost = ref.node.cloneNode(true);
      ghost.removeAttribute("tabindex");
      ghost.removeAttribute("data-motion");
      ghost.style.cssText += `;position:absolute;left:${rect.left-viewport.left}px;top:${rect.top-viewport.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;animation:none;`;
      layer.append(ghost);
    }
    st.viewport.append(layer);
    motionLayers.add(layer);
    commit();
    const outgoing = trackMotion(layer, [{opacity: .85, transform:"none"}, {opacity:0, transform:"translateY(14px) scale(.975)"}],
      {duration:180, easing:"cubic-bezier(.4,0,1,1)"});
    outgoing.finished.catch(() => {}).finally(() => { layer.remove(); motionLayers.delete(layer); });
    visibleItems().forEach(({ref, rect}, index) => {
      const previous = positions.get(ref.acc.id);
      const dx = previous ? OTP.clamp(previous.left - rect.left, -180, 180) : 0;
      const dy = previous ? OTP.clamp(previous.top - rect.top, -100, 100) : 24;
      trackMotion(ref.node, [
        {opacity:0, transform:`translate(${dx}px,${dy}px) scale(.94)`},
        {opacity:1, transform:"translateY(-2px) scale(1.008)", offset:.8},
        {opacity:1, transform:"none"},
      ], {duration:520, delay:65 + Math.min(index,12)*22, easing:"cubic-bezier(.16,1,.3,1)"});
    });
  }

  /* ── 行 ───────────────────────────────────────────────────────────────── */

  function buildRow(account) {
    const ring = OTP.ui.createRing({ period: account.period });
    const isPage = document.body.dataset.surface === "page";

    const emailNode = el("span", { class: "row-email truncate", text: account.email });
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
        "aria-label": account.email + "，点击复制验证码",
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

    const emailNode = el("span", { class: "row-email truncate", text: account.email });
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
        "aria-label": account.email + "，复制验证码",
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
        "aria-label": account.email + "，单击复制验证码",
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
    const emailNode = el("span", { class: "card-email truncate", text: account.email });
    const codeNode = el("span", { class: "code card-code", text: "· · ·" });
    const tools = buildTools(account, "card-tools");

    const node = el(
      "div",
      {
        class: "item card",
        tabindex: "0",
        role: "button",
        dataset: { id: account.id },
        "aria-label": account.email + "，点击复制验证码",
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

  function scheduleTick() {
    clearTimeout(st.rafId);
    if (!st.running || document.hidden) return;
    st.rafId = setTimeout(frame, 1000 - Date.now() % 1000 + 8);
  }

  function startTicker() {
    st.running = true;
    if (!st.rafId) scheduleTick();
  }

  function stopTicker() {
    st.running = false;
    clearTimeout(st.rafId);
    st.rafId = 0;
  }

  /**
   * 用同一个时间戳喂所有环：
   * · 弧长 = 显示的那个整数秒 / 周期 —— 数字和弧永远对得上，不可能各走各的；
   * · 每秒只写一次 DOM，中间靠 CSS 的 1s linear 过渡补间，所以又平滑又省；
   * · 跨周期时 snap 一下（瞬切回满格），不会反向扫一圈。
   */
  function tickRings(t) {
    const now = t || Date.now();
    for (const ref of st.refs.values()) {
      const cycle = OTP.totp.cycle(ref.acc.period, now);
      const seconds = Math.max(0, Math.ceil(cycle.remaining));

      if (seconds !== ref.shownSeconds) {
        const snap = !ref.placed ? true : cycle.counter !== ref.counter;
        ref.shownSeconds = seconds;
        ref.placed = true;
        ref.ring.paint({
          seconds,
          period: ref.acc.period,
          state: seconds <= 4 ? "hot" : seconds <= 10 ? "warn" : "calm",
          snap,
        });
      }
    }
  }

  function frame() {
    st.rafId = 0;
    if (!st.running || document.hidden) return;
    const time = Date.now();
    tickRings(time);
    for (const ref of st.refs.values()) {
      const cycle = OTP.totp.cycle(ref.acc.period, time);
      if (cycle.counter !== ref.counter) {
        ref.counter = cycle.counter;
        updateCode(ref);
      }
    }
    scheduleTick();
  }

  function updateCode(ref) {
    if (ref.pending) return ref.pending;
    if (!ref.node.isConnected) return Promise.resolve();
    ref.pending = OTP.totp.generate(ref.acc).then((result) => {
      if (!ref.node.isConnected) return;
      const changed = ref.code && ref.code !== result.code;
      ref.code = result.code;
      ref.codeNode.textContent = OTP.fmt.group(result.code);
      ref.codeNode.classList.remove("is-loading");
      if (changed) OTP.flash(ref.codeNode, "is-new", 420);
    }).catch(() => {
      ref.codeNode.textContent = "—— ——";
      ref.codeNode.classList.add("is-loading");
    }).finally(() => { ref.pending = null; });
    return ref.pending;
  }

  function refreshAll(force = true) {
    const jobs = [];
    // 同一戳、一次性把环放到当前进度（snap，不做补间）：
    // 既不会首帧"扫"一遍，也不会有逐行 Date.now() 造成的毫秒漂移。
    const t = Date.now();
    for (const ref of st.refs.values()) {
      const cycle = OTP.totp.cycle(ref.acc.period, t);
      const seconds = Math.max(0, Math.ceil(cycle.remaining));
      const needsCode = force || cycle.counter !== ref.counter;
      ref.counter = cycle.counter;
      ref.shownSeconds = seconds;
      ref.placed = true;
      ref.ring.paint({
        seconds,
        period: ref.acc.period,
        state: seconds <= 4 ? "hot" : seconds <= 10 ? "warn" : "calm",
        snap: true,
      });
      if (needsCode) jobs.push(updateCode(ref));
    }
    return Promise.all(jobs);
  }

  /** 复制前强制重算：别把周期边界上刚好过期的码写进剪贴板 */
  async function codeFor(account) {
    return OTP.totp.generate(account);
  }

  function codeMap() {
    const map = new Map();
    for (const [id, ref] of st.refs) if (ref.code) map.set(id, ref.code);
    return map;
  }

  /* ── 搜索聚光 ─────────────────────────────────────────────────────────── */

  /**
   * 不隐藏任何条目：命中项提亮 + 左侧品牌色光条，其余压低对比。
   * 保留空间关系，用户仍然知道"命中的那条在整列的哪儿"。
   */
  function applySearch(query, opts) {
    const o = opts || {};
    const q = String(query || "").trim();
    st.query = q;

    if (!q) {
      resetSpotlight();
      return { count: 0, total: st.refs.size };
    }

    const result = OTP.store.search(q, { codes: codeMap(), categoryId: st.categoryId });
    const hitMap = new Map();
    for (const hit of result.hits) hitMap.set(hit.account.id, hit);
    st.hitIds = result.hits.map((hit) => hit.account.id);

    for (const [id, ref] of st.refs) {
      const hit = hitMap.get(id);
      ref.hit = !!hit;
      ref.node.classList.toggle("is-match", !!hit);
      ref.node.classList.toggle("is-dim", !hit);

      const sig = hit ? JSON.stringify(hit.ranges) : "";
      if (sig !== ref.hlSig) {
        ref.hlSig = sig;
        const emailRanges = hit ? hit.ranges.email : [];
        const issuerRanges = hit ? hit.ranges.issuer : [];
        const codeRanges = hit ? hit.ranges.code : [];

        ref.emailNode.replaceChildren(highlight(ref.acc.email, emailRanges));
        ref.issuerNode.replaceChildren(highlight(issuerText(ref.acc), issuerRanges));
        ref.codeNode.replaceChildren(
          codeRanges.length
            ? highlight(OTP.fmt.group(ref.code), codeRanges, "is-code-hit")
            : document.createTextNode(OTP.fmt.group(ref.code))
        );
        ref.node.classList.toggle("is-code-hit", codeRanges.length > 0);
      }
    }

    if (result.hits.length) {
      st.activeIdx = st.order.indexOf(result.hits[0].account.id);
      markActive();
      if (o.scroll !== false) scrollToId(result.hits[0].account.id, { center: true });
      hideNoMatch();
    } else {
      st.activeIdx = -1;
      markActive();
      showNoMatch(q);
    }

    // 锁定优先于搜索聚光：只留被钉住的那一条
    if (st.focusId) applyFocus();

    return { count: result.hits.length, total: st.refs.size };
  }

  function highlight(text, ranges, extraClass) {
    const frag = document.createDocumentFragment();
    const value = String(text || "");
    let cursor = 0;
    for (const [start, end] of ranges || []) {
      if (start > cursor) frag.append(document.createTextNode(value.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.className = extraClass ? "hl " + extraClass : "hl";
      mark.textContent = value.slice(start, end);
      frag.append(mark);
      cursor = end;
    }
    if (cursor < value.length) frag.append(document.createTextNode(value.slice(cursor)));
    return frag;
  }

  function resetSpotlight() {
    st.hitIds = [];
    hideNoMatch();
    for (const ref of st.refs.values()) {
      ref.hit = false;
      ref.node.classList.remove("is-match", "is-dim", "is-code-hit");
      if (ref.hlSig) {
        ref.hlSig = "";
        ref.emailNode.replaceChildren(document.createTextNode(ref.acc.email));
        ref.issuerNode.replaceChildren(document.createTextNode(issuerText(ref.acc)));
        ref.codeNode.replaceChildren(document.createTextNode(OTP.fmt.group(ref.code)));
      }
    }
    // 清空搜索时把"当前项"也放掉，否则会留下一圈像是被选中的描边
    if (st.activeIdx !== -1) {
      st.activeIdx = -1;
      markActive();
    }
    if (st.focusId) applyFocus();
  }

  /* ── 聚焦锁定 ─────────────────────────────────────────────────────────── */

  /**
   * 把一条账号"钉"在视口里：只有它保持全亮，其余退到 14% 并去饱和。
   * 与搜索聚光叠加时，锁定的那一条优先。
   */
  function setFocusLock(id) {
    st.focusId = id || null;
    applyFocus();
    // 解除锁定时，把搜索聚光的明暗重新算一遍
    if (!st.focusId && st.query) applySearch(st.query, { scroll: false });
    return st.focusId;
  }

  function getFocusLock() {
    return st.focusId;
  }

  function applyFocus() {
    const locked = !!st.focusId;
    st.container.classList.toggle("has-focus", locked);

    for (const [id, ref] of st.refs) {
      const isFocus = locked && id === st.focusId;
      ref.node.classList.toggle("is-focus-lock", isFocus);
      if (locked) ref.node.classList.toggle("is-dim", !isFocus);
      else if (!st.query) ref.node.classList.remove("is-dim");
      if (ref.pin) {
        ref.pin.classList.toggle("is-on", isFocus);
        ref.pin.setAttribute("aria-pressed", String(isFocus));
      }
    }

    if (locked && st.refs.has(st.focusId)) scrollToId(st.focusId, { center: true });
  }

  /* ── 活动项 ───────────────────────────────────────────────────────────── */

  function setActiveById(id, scroll) {
    const index = st.order.indexOf(id);
    if (index === -1) return;
    st.activeIdx = index;
    markActive(scroll !== false);
  }

  function getActiveId() {
    return st.activeIdx >= 0 ? st.order[st.activeIdx] : null;
  }

  function moveActive(delta) {
    const pool = st.query && st.hitIds.length ? st.hitIds : st.order;
    if (!pool.length) return null;
    const currentId = getActiveId();
    let pos = pool.indexOf(currentId);
    if (pos === -1) pos = delta > 0 ? -1 : pool.length;
    const next = OTP.clamp(pos + delta, 0, pool.length - 1);
    const nextId = pool[next];
    st.activeIdx = st.order.indexOf(nextId);
    markActive(true);
    return nextId;
  }

  function markActive(ensureVisible) {
    for (const [id, ref] of st.refs) {
      ref.node.classList.toggle("is-active", st.order[st.activeIdx] === id);
    }
    if (ensureVisible) {
      const id = getActiveId();
      if (id) scrollToId(id, { center: false });
    }
  }

  /* ── 滚动定位 ─────────────────────────────────────────────────────────── */

  function scrollToId(id, opts) {
    const ref = st.refs.get(id);
    if (!ref) return;
    const o = opts || {};
    const box = st.container;
    const boxRect = box.getBoundingClientRect();
    const nodeRect = ref.node.getBoundingClientRect();

    const visible =
      nodeRect.top >= boxRect.top + 4 && nodeRect.bottom <= boxRect.bottom - 4;
    if (visible && !o.center) return;

    const relativeTop = nodeRect.top - boxRect.top + box.scrollTop;
    const viewH = box.clientHeight;
    const nodeH = nodeRect.height;

    let target;
    if (o.center) target = relativeTop - (viewH - nodeH) / 2;
    else if (nodeRect.top < boxRect.top) target = relativeTop - 8;
    else target = relativeTop - viewH + nodeH + 8;

    const max = Math.max(0, box.scrollHeight - box.clientHeight);
    OTP.animateScroll(box, OTP.clamp(target, 0, max), o.center ? 380 : 260);
  }

  function scrollToTop() {
    if (st.container) OTP.animateScroll(st.container, 0, 320);
  }

  /* ── 边缘渐隐 ─────────────────────────────────────────────────────────── */

  function updateEdges() {
    const box = st.container;
    if (!box || !st.viewport) return;
    const max = box.scrollHeight - box.clientHeight;
    const top = box.scrollTop > 4;
    const bottom = max > 4 && box.scrollTop < max - 4;
    let edge = "none";
    if (top && bottom) edge = "both";
    else if (top) edge = "top";
    else if (bottom) edge = "bottom";
    st.viewport.dataset.edge = edge;
  }

  /* ── 空状态 ───────────────────────────────────────────────────────────── */

  function showEmpty() {
    removeEmpty();
    const filtered = !!st.categoryId;
    st.emptyNode = el(
      "div",
      { class: "empty" },
      el("div", { class: "empty-mark", html: icon("keyhole", 24, "i-lg") }),
      el("div", { class: "empty-title", text: filtered ? "这个分类还是空的" : "还没有任何账号" }),
      el("div", {
        class: "empty-text",
        text: filtered
          ? "把已有账号移到这个分类，或者直接新增一条。"
          : "可以逐条新增，也可以粘贴「邮箱----密码----2FA密钥」批量导入。",
      }),
      el(
        "div",
        { class: "empty-actions" },
        el("button", {
          class: "btn btn-primary btn-sm",
          type: "button",
          html: icon("plus", 13, "i-sm") + "<span>新增账号</span>",
          onclick: () => st.actions.add(),
        }),
        el("button", {
          class: "btn btn-ghost btn-sm",
          type: "button",
          html: icon("upload", 13, "i-sm") + "<span>批量导入</span>",
          onclick: () => st.actions.import(),
        })
      )
    );
    st.container.append(st.emptyNode);
  }

  function removeEmpty() {
    if (st.emptyNode) {
      st.emptyNode.remove();
      st.emptyNode = null;
    }
  }

  function showNoMatch(query) {
    hideNoMatch();
    st.noMatchNode = el(
      "div",
      { class: "no-match" },
      el("span", { html: icon("search", 13, "i-sm") }),
      el("span", { text: "没有匹配「" + query + "」的账号" })
    );
    st.viewport.append(st.noMatchNode);
  }

  function hideNoMatch() {
    if (st.noMatchNode) {
      st.noMatchNode.remove();
      st.noMatchNode = null;
    }
  }

  /* ── 小工具 ───────────────────────────────────────────────────────────── */

  function issuerText(account) {
    return account.issuer || account.note || "未命名服务";
  }

  /* ── 对外 ─────────────────────────────────────────────────────────────── */

  OTP.list = {
    mount,
    render,
    reveal,
    prepareMotion,
    cancelMotion,
    transitionLayout,
    applySearch,
    resetSpotlight,
    setActiveById,
    getActiveId,
    moveActive,
    scrollToId,
    scrollToTop,
    codeFor,
    codeMap,
    refreshAll,
    startTicker,
    stopTicker,
    updateEdges,
    setFocusLock,
    getFocusLock,
    setCategory(id) {
      st.categoryId = id || "";
    },
    getState: () => st,
    getRef: (id) => st.refs.get(id),
  };
})(window);
