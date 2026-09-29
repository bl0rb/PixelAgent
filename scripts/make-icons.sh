#!/bin/sh
# Regenerates the raster icons from the SVG sources (macOS only: sips + iconutil).
#   assets/icon.svg        – product/web icon (64×64 grid)
#   assets/icon-macos.svg  – macOS app icon (1024 canvas, 824 squircle + shadow)
set -eu
cd "$(dirname "$0")/../assets"
tmp=$(mktemp -d)
mkdir "$tmp/PixelAgent.iconset"
for s in 16 32 128 256 512; do
  sips -s format png -z "$s" "$s" icon-macos.svg --out "$tmp/PixelAgent.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -s format png -z "$d" "$d" icon-macos.svg --out "$tmp/PixelAgent.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$tmp/PixelAgent.iconset" -o PixelAgent.icns
sips -s format png -z 512 512 icon.svg --out icon-512.png >/dev/null
# launcher favicons (served by the proxy under /__uce/static/)
cp icon.svg ../src/proxy/static/icon.svg
sips -s format png -z 32 32 icon.svg --out ../src/proxy/static/favicon-32.png >/dev/null
sips -s format png -z 180 180 icon.svg --out ../src/proxy/static/apple-touch-icon.png >/dev/null
rm -rf "$tmp"
echo "Icons written to $(pwd)"
