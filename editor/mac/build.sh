#!/bin/bash
# Builds Portfolio.app and installs it. Only needed again if main.swift or the
# icon changes: the editor itself is loaded from this folder every launch.
# Usage: editor/mac/build.sh [install folder, default /Applications]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SITE_ROOT="$(cd "$HERE/../.." && pwd)"
DEST="${1:-/Applications}"
NAME="Portfolio"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

APP="$WORK/$NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -target "$(uname -m)-apple-macos13" -framework Cocoa -framework WebKit \
  "$HERE/main.swift" -o "$APP/Contents/MacOS/$NAME"

swiftc -O -framework Cocoa "$HERE/make-icon.swift" -o "$WORK/make-icon"
"$WORK/make-icon" "$WORK/icon.png"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$WORK/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z "$((s * 2))" "$((s * 2))" "$WORK/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>site.shaurya.portfolio</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSDesktopFolderUsageDescription</key><string>Your site's files live on the Desktop, and Portfolio edits them.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>PortfolioSiteRoot</key><string>$SITE_ROOT</string>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP" >/dev/null 2>&1

mkdir -p "$DEST"
rm -rf "${DEST:?}/$NAME.app"
ditto "$APP" "$DEST/$NAME.app"
echo "Installed $DEST/$NAME.app"
