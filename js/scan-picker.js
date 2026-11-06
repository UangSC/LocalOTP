/* 管理页和网页预览使用浏览器自己的来源选择器；截图后立即停止共享。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  OTP.captureFromPicker = async function ({ signal } = {}) {
    if (!navigator.mediaDevices?.getDisplayMedia)
      throw new Error("此页面无法调起截图选择器，请在浏览器扩展管理页或 localhost 预览中使用");
    let stream, video, timeout;
    const stop = () => stream?.getTracks().forEach((track) => track.stop());
    signal?.addEventListener("abort", stop, { once: true });
    try {
      const controller = typeof CaptureController === "function" ? new CaptureController() : null;
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "exclude",
        ...(controller ? { controller } : {}),
      });
      try {
        controller?.setFocusBehavior("no-focus-change");
      } catch (_) {}
      if (signal?.aborted) return null;
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.style.cssText =
        "position:fixed;width:1px;height:1px;left:0;bottom:0;opacity:0;pointer-events:none";
      document.body.append(video);
      video.srcObject = stream;
      await Promise.race([
        video.play(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("画面尚未准备好，请重新选择网页")), 5000);
        }),
      ]);
      clearTimeout(timeout);
      if (signal?.aborted) return null;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (!canvas.width || !canvas.height) throw new Error("没有获取到画面，请重新选择网页");
      if (canvas.width * canvas.height > 24000000) throw new Error("画面过大，请缩小窗口后重试");
      canvas.getContext("2d").drawImage(video, 0, 0);
      const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
      canvas.width = canvas.height = 0;
      return signal?.aborted ? null : blob;
    } catch (error) {
      if (error.name === "NotAllowedError" || error.name === "AbortError") return null;
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      stop();
      if (video) {
        video.pause();
        video.srcObject = null;
        video.remove();
      }
    }
  };
})(globalThis);
