"""将浏览器演示帧转换为可在项目文档中播放的动图。需要 Pillow。"""
import argparse
import base64
import io
import json
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser(description="将实际浏览器录制帧编码为动图")
parser.add_argument("--input", type=Path, required=True, help="浏览器帧 JSON 路径")
parser.add_argument("--output", type=Path, required=True, help="输出 WebP 或 GIF 路径")
args = parser.parse_args()
frames = json.loads(args.input.read_text(encoding="utf-8"))
images = [Image.open(io.BytesIO(base64.b64decode(frame["data"]))).convert("RGB") for frame in frames]
durations = [max(20, min(1200, round((frames[index + 1]["time"] - frame["time"]) * 1000)))
             if index + 1 < len(frames) else 700 for index, frame in enumerate(frames)]
args.output.parent.mkdir(parents=True, exist_ok=True)
images[0].save(args.output, save_all=True, append_images=images[1:], duration=durations, loop=0, quality=80)
print(f"已生成 {args.output}，{len(images)} 帧，{sum(durations) / 1000:.1f} 秒")
