"""在隔离临时目录验证可重复打包、错误版本和篡改拒绝，不修改真实版本。"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools/package.py"
VERSION = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
FILENAME = f"LocalOTP-{VERSION}.zip"


def checksum(path):
    value = hashlib.sha256(path.read_bytes()).hexdigest()
    path.with_name(path.name + ".sha256").write_text(f"{value}  {path.name}\n", encoding="utf-8", newline="\n")


class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        artifacts = ROOT / "artifacts"
        artifacts.mkdir(exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix="package-test-", dir=artifacts)
        cls.directory = Path(cls.temporary.name)
        cls.original = cls.directory / "first" / FILENAME
        cls.run_command("--output", cls.original)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    @staticmethod
    def run_command(*arguments, expected=0):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *map(str, arguments)], cwd=ROOT,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        if (result.returncode == 0) != (expected == 0):
            raise AssertionError(f"意外退出码 {result.returncode}\n{result.stdout}\n{result.stderr}")
        return result

    def copy_package(self, case):
        output = self.directory / case / FILENAME
        output.parent.mkdir()
        shutil.copyfile(self.original, output)
        shutil.copyfile(self.original.with_name(FILENAME + ".sha256"), output.with_name(FILENAME + ".sha256"))
        return output

    def rewrite_entry(self, path, target, transform):
        with ZipFile(path) as archive:
            entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
        with ZipFile(path, "w") as archive:
            for info, data in entries:
                archive.writestr(info, transform(data) if info.filename == target else data)
        checksum(path)

    def test_repeat_build_has_identical_bytes(self):
        second = self.directory / "second" / FILENAME
        self.run_command("--output", second)
        self.assertEqual(self.original.read_bytes(), second.read_bytes())
        self.assertEqual(self.original.with_name(FILENAME + ".sha256").read_bytes(), second.with_name(FILENAME + ".sha256").read_bytes())
        self.run_command("--verify-only", second)

    def test_wrong_filename_is_rejected_before_overwrite(self):
        output = self.directory / "LocalOTP-9.9.9-fix.zip"
        output.write_bytes(b"keep-existing-file")
        result = self.run_command("--output", output, expected=1)
        self.assertIn("文件名必须", result.stderr)
        self.assertEqual(output.read_bytes(), b"keep-existing-file")

    def test_internal_version_is_rejected_with_valid_checksum(self):
        output = self.copy_package("wrong-version")
        def change_version(data):
            manifest = json.loads(data)
            manifest["version"] = "9.9.9"
            return json.dumps(manifest).encode("utf-8")
        self.rewrite_entry(output, "manifest.json", change_version)
        previous = output.read_bytes()
        result = self.run_command("--verify-only", output, expected=1)
        self.assertIn("包内 manifest 版本", result.stderr)
        self.assertEqual(output.read_bytes(), previous)

    def test_modified_content_is_rejected_with_valid_checksum(self):
        output = self.copy_package("wrong-content")
        self.rewrite_entry(output, "README.md", lambda data: data + b"\nmodified\n")
        result = self.run_command("--verify-only", output, expected=1)
        self.assertIn("包内文件内容与源码不一致", result.stderr)

    def test_wrong_checksum_is_rejected(self):
        output = self.copy_package("wrong-checksum")
        output.with_name(FILENAME + ".sha256").write_text(f"{'0' * 64}  {FILENAME}\n", encoding="utf-8")
        result = self.run_command("--verify-only", output, expected=1)
        self.assertIn("SHA256", result.stderr)

    def test_unexpected_file_is_rejected(self):
        output = self.copy_package("unexpected-file")
        with ZipFile(output, "a") as archive:
            archive.writestr("unexpected.txt", "unexpected")
        checksum(output)
        result = self.run_command("--verify-only", output, expected=1)
        self.assertIn("ZIP 文件清单", result.stderr)

    def test_metadata_and_line_endings_are_fixed(self):
        with ZipFile(self.original) as archive:
            self.assertEqual(archive.namelist(), sorted(archive.namelist()))
            for info in archive.infolist():
                self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(info.create_system, 3)
                self.assertEqual(info.external_attr >> 16, 0o100644)
                if Path(info.filename).suffix in {".json", ".md", ".html", ".js", ".css", ".txt", ".LICENSE"}:
                    self.assertNotIn(b"\r\n", archive.read(info.filename))


if __name__ == "__main__":
    unittest.main(verbosity=2)
