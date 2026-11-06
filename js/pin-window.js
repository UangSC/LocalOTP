/* 工具栏弹窗不能持久置顶：先建立稳定的独立小窗，再由用户手势打开 Document PiP。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  OTP.mountPinWindow = function (button) {
    const mode = document.documentElement.dataset.floating;
    if (mode) document.title = mode === "pip" ? "LocalOTP · 置顶" : "LocalOTP · 常驻小窗";
    let busy = false;
    button.innerHTML = OTP.icon("pin", 15) + "<span>" + (mode === "pip" ? "取消" : mode === "1" ? "置顶" : "常驻") + "</span>";
    const label = mode === "pip" ? "取消置顶，返回独立小窗" : mode === "1" ? "始终置顶（画中画）" : "固定为独立小窗";
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tip", label);
    button.setAttribute("aria-pressed", String(mode === "pip"));
    if (mode === "1" && !global.documentPictureInPicture) {
      button.setAttribute("aria-label", "当前浏览器不支持始终置顶");
      button.setAttribute("data-tip", "小窗已常驻；始终置顶需要支持文档画中画的浏览器");
    }
    button.addEventListener("click", async () => {
      if (busy) return;
      if (mode === "pip") { global.parent.close(); return; }
      if (mode !== "1") {
        busy = true; button.disabled = true;
        try {
          if (!OTP.access.available) throw new Error("请先将本项目加载为扩展，再打开独立小窗");
          await OTP.access.float();
        } catch (error) { OTP.ui.toast(error.message, "bad"); }
        finally { busy = false; button.disabled = false; }
        return;
      }
      if (!global.documentPictureInPicture) { OTP.ui.toast("当前小窗点击外部不会关闭；浏览器暂不支持系统置顶", "warn"); return; }
      busy = true; button.disabled = true;
      let pip;
      try {
        // 必须在点击栈里先请求画中画，不能先等待后台票据而丢失用户激活。
        pip = await global.documentPictureInPicture.requestWindow({ width: 402, height: 600 });
        pip.document.title = "LocalOTP · 始终置顶";
        const ticket = await OTP.access.ticket();
        const frame = pip.document.createElement("iframe");
        frame.src = chrome.runtime.getURL("popup.html") + "?floating=pip#unlock=" + encodeURIComponent(ticket);
        frame.title = "LocalOTP 置顶窗口";
        frame.style.cssText = "border:0;width:100%;height:100%;display:block";
        pip.document.documentElement.style.cssText = "width:100%;height:100%";
        pip.document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden";
        pip.document.body.append(frame);
        const app = document.getElementById("app");
        app.inert = true;
        document.body.dataset.pipOwner = "1";
        const cover = OTP.el("div", { class: "pip-cover", role: "status" },
          OTP.el("span", { class: "pip-cover-icon", html: OTP.icon("pin", 26) }),
          OTP.el("h1", { text: "小窗已置顶" }),
          OTP.el("p", { text: "验证码正在画中画窗口中显示。关闭此窗口也会结束置顶。" }),
          OTP.el("button", { class: "btn btn-primary", type: "button", text: "返回独立小窗", onclick: () => pip.close() }));
        document.body.append(cover); cover.querySelector("button").focus();
        pip.addEventListener("pagehide", () => { cover.remove(); app.inert = false; delete document.body.dataset.pipOwner; button.focus(); }, { once: true });
      } catch (_) { pip?.close(); OTP.ui.toast("浏览器未能打开置顶窗口，独立小窗仍可继续使用", "bad"); }
      finally { busy = false; button.disabled = false; }
    });
  };
})(globalThis);
