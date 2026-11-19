/* 由 tools/version.mjs 根据 manifest.json 生成；请勿手工修改。 */
(function (global) {
  "use strict";
  const OTP = global.OTP || (global.OTP = {});
  const previewVersion = "1.0.0";
  Object.defineProperty(OTP, "version", {
    enumerable: true,
    configurable: true,
    get() { return global.chrome?.runtime?.getManifest?.().version || previewVersion; },
  });
})(globalThis);
