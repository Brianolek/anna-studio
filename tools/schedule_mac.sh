#!/bin/bash
# Sort a folder once a day on this Mac, automatically.
#   bash tools/schedule_mac.sh ~/Desktop/Studio 20:00
# Writes a LaunchAgent that runs tools/ingest.mjs --inbox <folder> at <HH:MM> every day, and loads it.
# Log: ~/Library/Logs/anna-studio-ingest.log. Remove with: launchctl unload ~/Library/LaunchAgents/com.anna-studio.ingest.plist
set -e
INBOX="${1:?usage: schedule_mac.sh <folder> [HH:MM]}"; AT="${2:-20:00}"
INBOX="$(cd "$INBOX" && pwd)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"; H="${AT%%:*}"; M="${AT##*:}"
PLIST="$HOME/Library/LaunchAgents/com.anna-studio.ingest.plist"
[ -f "$ROOT/.env" ] || { echo "Put your key in $ROOT/.env first, one line: ANTHROPIC_API_KEY=sk-ant-..."; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.anna-studio.ingest</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/tools/ingest.mjs</string><string>--inbox</string><string>$INBOX</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$((10#$H))</integer><key>Minute</key><integer>$((10#$M))</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/anna-studio-ingest.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/anna-studio-ingest.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Scheduled: $INBOX sorted daily at $AT. Log: ~/Library/Logs/anna-studio-ingest.log"
