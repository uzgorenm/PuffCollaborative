#!/usr/bin/env python3
"""Turn captured UI screenshots into a captioned MP4 walkthrough.

Requires Pillow and ffmpeg. Image paths and output paths are relative to the
manifest unless absolute. Cursor coordinates are in the source image's pixels.

Example manifest:
{
  "title": "Puff • Interactive demo walkthrough",
  "output": "puff-walkthrough.mp4",
  "steps": [
    {"image": "frames/01.png", "caption": "Create a project and assign work.",
     "duration": 4.5, "cursor": [420, 260], "click": true}
  ]
}

Run: python3 render_walkthrough.py path/to/manifest.json
The output is 1280 × 810: a 1280 × 720 screenshot area and a 90 px caption band.
Only the cursor and caption band are drawn; captured application UI is retained.
"""

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
except ImportError:
    sys.exit("Pillow is required. Use a Python runtime with Pillow installed.")


WIDTH = 1280
UI_HEIGHT = 720
CAPTION_HEIGHT = 90
HEIGHT = UI_HEIGHT + CAPTION_HEIGHT
FPS = 24
MOTION_SECONDS = 0.8
CLICK_SECONDS = 0.6


def font(size):
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def fit_text(draw, text, typeface, maximum_width, maximum_lines=2):
    lines = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=typeface) <= maximum_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
    if current:
        lines.append(current)
    if len(lines) <= maximum_lines and all(
        draw.textlength(line, font=typeface) <= maximum_width for line in lines
    ):
        return lines
    omitted = len(lines) > maximum_lines
    lines = lines[:maximum_lines]
    for index, line in enumerate(lines):
        if draw.textlength(line, font=typeface) <= maximum_width and not (omitted and index == len(lines) - 1):
            continue
        line = line.rstrip(".") + "…"
        while draw.textlength(line, font=typeface) > maximum_width:
            line = line[:-2].rstrip() + "…"
        lines[index] = line
    return lines


def cursor_image():
    # Supersampling preserves a crisp outline at fractional cursor positions.
    multiplier = 3
    cursor = Image.new("RGBA", (28 * multiplier, 34 * multiplier))
    draw = ImageDraw.Draw(cursor)
    points = [(1, 1), (1, 24), (7, 18), (12, 29), (18, 26), (12, 16), (24, 16)]
    draw.polygon(
        [(x * multiplier, y * multiplier) for x, y in points],
        fill="white",
        outline="#141821",
        width=2 * multiplier,
    )
    return cursor.resize((28, 34), Image.Resampling.LANCZOS)


def read_manifest(path):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("steps"), list):
        raise ValueError("Manifest must be an object with a steps array.")
    if not manifest["steps"]:
        raise ValueError("Manifest must contain at least one step.")
    for index, step in enumerate(manifest["steps"], 1):
        if not isinstance(step, dict) or not isinstance(step.get("image"), str):
            raise ValueError(f"Step {index} requires an image path.")
        if not isinstance(step.get("caption", ""), str):
            raise ValueError(f"Step {index} caption must be text.")
        duration = step.get("duration", 4.5)
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration < 1:
            raise ValueError(f"Step {index} duration must be at least one second.")
        cursor = step.get("cursor")
        if cursor is not None and (
            not isinstance(cursor, list)
            or len(cursor) != 2
            or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in cursor)
        ):
            raise ValueError(f"Step {index} cursor must be a numeric [x, y] pair.")
        if "click" in step and not isinstance(step["click"], bool):
            raise ValueError(f"Step {index} click must be true or false.")
        step["image"] = (path.parent / step["image"]).resolve()
        if not step["image"].is_file():
            raise ValueError(f"Step {index} image does not exist: {step['image']}")
        step["duration"] = duration
    title = manifest.get("title", "Puff • Interactive demo walkthrough")
    if not isinstance(title, str):
        raise ValueError("Manifest title must be text.")
    output = manifest.get("output", "puff-walkthrough.mp4")
    if not isinstance(output, str):
        raise ValueError("Manifest output must be a path string.")
    manifest["output"] = (path.parent / output).resolve()
    if manifest["output"].suffix.lower() != ".mp4":
        raise ValueError("Output filename must end in .mp4.")
    return manifest


def screenshot_frame(step, title, index, count, caption_font, title_font):
    with Image.open(step["image"]) as source:
        source = ImageOps.exif_transpose(source).convert("RGB")
        scale = min(WIDTH / source.width, UI_HEIGHT / source.height)
        size = (round(source.width * scale), round(source.height * scale))
        offset = ((WIDTH - size[0]) // 2, (UI_HEIGHT - size[1]) // 2)
        frame = Image.new("RGB", (WIDTH, HEIGHT), "#0f121a")
        frame.paste(source.resize(size, Image.Resampling.LANCZOS), offset)
        target = None
        if step.get("cursor") is not None:
            x, y = step["cursor"]
            if not (0 <= x < source.width and 0 <= y < source.height):
                raise ValueError(f"Step {index} cursor is outside its {source.width} × {source.height} screenshot.")
            target = (offset[0] + x * scale, offset[1] + y * scale)
    draw = ImageDraw.Draw(frame)
    draw.rectangle((0, UI_HEIGHT, WIDTH, HEIGHT), fill="#111722")
    draw.line((0, UI_HEIGHT, WIDTH, UI_HEIGHT), fill="#2d3542", width=1)
    title_lines = fit_text(draw, title, title_font, WIDTH - 150, maximum_lines=1)
    draw.text((32, UI_HEIGHT + 9), title_lines[0] if title_lines else "", font=title_font, fill="#9ba8b9")
    count_text = f"{index:02d} / {count:02d}"
    draw.text((WIDTH - 32 - draw.textlength(count_text, font=title_font), UI_HEIGHT + 9), count_text, font=title_font, fill="#9ba8b9")
    for line_index, line in enumerate(fit_text(draw, step.get("caption", ""), caption_font, WIDTH - 64)):
        draw.text((32, UI_HEIGHT + 32 + line_index * 25), line, font=caption_font, fill="#f6f8fc")
    return frame, target


def render(manifest, ffmpeg):
    manifest["output"].parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{WIDTH}x{HEIGHT}",
        "-framerate", str(FPS), "-i", "pipe:0", "-an", "-c:v", "libx264",
        "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(manifest["output"]),
    ]
    caption_font = font(22)
    title_font = font(15)
    cursor = cursor_image()
    previous_target = None
    total_frames = 0
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for index, step in enumerate(manifest["steps"], 1):
            still, target = screenshot_frame(step, manifest.get("title", "Puff • Interactive demo walkthrough"), index, len(manifest["steps"]), caption_font, title_font)
            start = previous_target or target
            frames = round(step["duration"] * FPS)
            print(f"Rendering step {index}/{len(manifest['steps'])}: {step['caption'] if 'caption' in step else step['image'].name}", flush=True)
            for frame_index in range(frames):
                frame = still.copy()
                seconds = frame_index / FPS
                if target is not None:
                    progress = min(seconds / MOTION_SECONDS, 1)
                    eased = progress * progress * (3 - 2 * progress)
                    x = start[0] + (target[0] - start[0]) * eased
                    y = start[1] + (target[1] - start[1]) * eased
                    click_progress = (seconds - MOTION_SECONDS) / CLICK_SECONDS
                    if step.get("click", False) and 0 <= click_progress <= 1:
                        overlay = Image.new("RGBA", frame.size)
                        ring = ImageDraw.Draw(overlay)
                        radius = 8 + 22 * click_progress
                        ring.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(115, 186, 255, round(220 * (1 - click_progress))), width=3)
                        frame = Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")
                    frame.paste(cursor, (round(x) - 1, round(y) - 1), cursor)
                process.stdin.write(frame.tobytes())
                total_frames += 1
            previous_target = target or previous_target
        process.stdin.close()
        error = process.stderr.read().decode("utf-8", errors="replace")
        status = process.wait()
        if status:
            raise RuntimeError(f"ffmpeg failed with exit code {status}: {error.strip()}")
    except BaseException:
        if process.poll() is None:
            process.kill()
        process.wait()
        raise
    finally:
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        process.stderr.close()
    print(f"Saved {manifest['output']} ({total_frames / FPS:.2f}s, {WIDTH} × {HEIGHT}, {FPS} fps)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path, help="JSON manifest containing captured UI screenshots and captions")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"), help="ffmpeg executable path")
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error("ffmpeg was not found. Pass --ffmpeg /path/to/ffmpeg.")
    try:
        render(read_manifest(args.manifest.resolve()), args.ffmpeg)
    except (ValueError, OSError, RuntimeError, json.JSONDecodeError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
