"""生成和校验可重复的扩展 ZIP；版本、文件名、内容和 SHA256 必须一致。"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_STORED, BadZipFile, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
TEXT_SUFFIXES = {".json", ".md", ".html", ".js", ".css", ".txt", ".LICENSE"}
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def version():
    return json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]


def package_files():
    files = [ROOT / name for name in ("manifest.json", "README.md", "index.html", "popup.html", "api.html")]
    for directory, suffixes in (("js", {".js", ".LICENSE"}), ("styles", {".css"}), ("assets/icons", {".png"})):
        files.extend(path for path in (ROOT / directory).rglob("*") if path.is_file() and path.suffix in suffixes)
    files.extend(ROOT / "docs" / name for name in (
        "scan-and-import.md", "third-party.md", "architecture.md", "testing.md", "design-system.md", "release-guide.md",
        "otp-api.md", "window-and-session.md", "sync-guide.md", "examples/sync-test.txt",
    ))
    # 按 POSIX 名字的字符顺序排序，避开 Windows Path 的大小写折叠排序差异。
    ordered = sorted(files, key=lambda path: path.relative_to(ROOT).as_posix())
    return {path.relative_to(ROOT).as_posix(): source_bytes(path) for path in ordered}


def source_bytes(path):
    data = path.read_bytes()
    if path.suffix in TEXT_SUFFIXES:
        # 固定 LF；二进制图标保持原始字节。
        data = data.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
    return data


def require_filename(path, release_version):
    expected = f"LocalOTP-{release_version}.zip"
    if path.name != expected:
        raise ValueError(f"文件名必须为 {expected}，不能使用其他版本号或 fix 后缀")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checksum_path(path):
    return path.with_name(path.name + ".sha256")


def verify_archive(path, release_version, files):
    with ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(files):
            raise ValueError("ZIP 文件清单与当前源码不一致，或存在重复文件")
        if archive.testzip():
            raise ValueError("ZIP 完整性校验失败")
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        if manifest.get("version") != release_version:
            raise ValueError("包内 manifest 版本与当前源码不一致")
        for name, expected in files.items():
            if archive.read(name) != expected:
                raise ValueError(f"包内文件内容与源码不一致：{name}")
        return len(names)


def verify_package(path, release_version, files):
    require_filename(path, release_version)
    count = verify_archive(path, release_version, files)
    expected = f"{digest(path)}  {path.name}\n"
    if checksum_path(path).read_text(encoding="utf-8") != expected:
        raise ValueError("SHA256 校验和或校验文件中的包名不匹配")
    return count


def build_package(path, release_version, files):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".localotp-", suffix=".zip", dir=path.parent, delete=False) as temporary:
            temporary_path = Path(temporary.name)
        # 不压缩，避免不同系统的 zlib 版本改变 ZIP 字节；扩展资源仍只有约 1 MiB。
        with ZipFile(temporary_path, "w", compression=ZIP_STORED) as archive:
            for name, data in files.items():
                info = ZipInfo(name, date_time=ZIP_TIMESTAMP)
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = ZIP_STORED
                archive.writestr(info, data)
        verify_archive(temporary_path, release_version, files)
        os.replace(temporary_path, path)
        temporary_path = None
        checksum_path(path).write_text(f"{digest(path)}  {path.name}\n", encoding="utf-8", newline="\n")
        return verify_package(path, release_version, files)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="打包或只读校验 LocalOTP 扩展，可在 Windows / macOS 使用")
    options = parser.add_mutually_exclusive_group()
    options.add_argument("--output", type=Path, help="输出 ZIP 路径；文件名必须为 LocalOTP-当前版本.zip")
    options.add_argument("--verify-only", type=Path, metavar="ZIP", help="只读校验已有 ZIP 及其 .sha256，不覆盖任何文件")
    args = parser.parse_args()
    try:
        release_version = version()
        output = args.verify_only or args.output or ROOT / "dist" / f"LocalOTP-{release_version}.zip"
        require_filename(output, release_version)
        if args.verify_only:
            count = verify_package(output, release_version, package_files())
            print(f"校验通过：{output.resolve()}（{count} 个文件，版本 {release_version}，SHA256 一致）")
        else:
            subprocess.run(["node", str(ROOT / "tools/check-project.mjs")], cwd=ROOT, check=True)
            count = build_package(output, release_version, package_files())
            print(f"打包完成：{output.resolve()}（{count} 个文件，{output.stat().st_size:,} 字节）")
            print(f"校验文件：{checksum_path(output).resolve()}")
        return 0
    except (OSError, ValueError, KeyError, BadZipFile, subprocess.CalledProcessError) as error:
        print(f"打包检查失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
