#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/img"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

HTML_PATH="$TMP_DIR/icon.html"
MASTER_PATH="$OUTPUT_DIR/icon-master.png"

cat >"$HTML_PATH" <<'EOF'
<!doctype html>
<html lang="en">
  <body
    style="
      margin: 0;
      width: 512px;
      height: 512px;
      display: grid;
      place-items: center;
      overflow: hidden;
      background: transparent;
    "
  >
    <div
      style="
        width: 448px;
        height: 448px;
        border-radius: 112px;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 28% 22%, #9df0ff 0%, #56c5eb 34%, #0d76c8 70%, #084f94 100%);
        box-shadow:
          inset 0 10px 28px rgba(255, 255, 255, 0.24),
          inset 0 -18px 28px rgba(0, 0, 0, 0.18);
        font-family: 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif;
        font-size: 292px;
        line-height: 1;
        transform: translateY(-4px);
      "
    >
      ⛵
    </div>
  </body>
</html>
EOF

google-chrome \
  --headless=new \
  --disable-gpu \
  --hide-scrollbars \
  --window-size=512,512 \
  --default-background-color=00000000 \
  --screenshot="$MASTER_PATH" \
  "file://$HTML_PATH" >/dev/null 2>&1

for size in 16 32 48 128; do
  convert "$MASTER_PATH" \
    -filter Lanczos \
    -resize "${size}x${size}" \
    -unsharp 0x0.75+0.75+0.008 \
    "$OUTPUT_DIR/icon-${size}.png"
done

echo "Rendered extension icons into $OUTPUT_DIR"
