"""生成仅包含扩展运行文件的 ZIP，不打包测试数据、截图、缓存或本机配置。"""
import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main():
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description="打包 LocalOTP 扩展，可在 Windows / macOS 使用")
    parser.add_argument("--output", type=Path, help="输出 ZIP 路径；默认 dist/LocalOTP-版本.zip")
    args = parser.parse_args()
    output = args.output or root / "dist" / f"LocalOTP-{manifest['version']}.zip"
    files = [root / name for name in ("manifest.json", "index.html", "popup.html", "api.html")]
    for directory, suffixes in (("js", {".js"}), ("styles", {".css"}), ("assets/icons", {".png"})):
        files.extend(path for path in (root / directory).iterdir() if path.is_file() and path.suffix in suffixes)
    files.extend(root / "docs" / name for name in ("otp-api.md", "window-and-session.md", "sync-guide.md"))
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.write(path, path.relative_to(root).as_posix())
    with ZipFile(output) as archive:
        if archive.testzip():
            raise RuntimeError("ZIP 完整性校验失败")
        print(f"打包完成：{output.resolve()}（{len(archive.namelist())} 个文件，{output.stat().st_size:,} 字节）")


if __name__ == "__main__":
    main()
