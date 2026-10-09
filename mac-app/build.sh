#!/bin/bash
# Builds LectureScribe.app (menu-bar app). Run: ./build.sh   then: open LectureScribe.app
set -e
cd "$(dirname "$0")"
swift build -c release
APP=LectureScribe.app
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
cp .build/release/LectureScribeMac "$APP/Contents/MacOS/LectureScribe"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>LectureScribe</string>
  <key>CFBundleDisplayName</key><string>Lecture Scribe</string>
  <key>CFBundleIdentifier</key><string>app.lecturescribe.mac</string>
  <key>CFBundleExecutable</key><string>LectureScribe</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Lecture Scribe records the lecturer through the microphone to transcribe it on this Mac.</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
echo "Built $APP"
