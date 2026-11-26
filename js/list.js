/* LocalOTP · list 列表 / 卡片渲染、倒计时调度、搜索聚光、键盘活动项、复制回执。 */

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
      const catIcon = account.categoryId ? (OTP.store.categoryOf(account.categoryId)?.icon || "") : "";
      const signature = JSON.stringify([account, catIcon]);
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
  const { cancelMotion, reveal, prepareMotion, transitionLayout } = OTP.createListMotion({ st });

  const { buildRow, buildQuick, buildCard } = OTP.createListItems({ st, setActiveById, issuerText });

  const { scheduleTick, startTicker, stopTicker, refreshAll, codeFor, codeMap } = OTP.createListTicker({ st });

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

        ref.emailNode.replaceChildren(highlight(ref.acc.email || ref.acc.issuer || "未命名 OTP", ref.acc.email ? emailRanges : issuerRanges));
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
        ref.emailNode.replaceChildren(document.createTextNode(ref.acc.email || ref.acc.issuer || "未命名 OTP"));
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
