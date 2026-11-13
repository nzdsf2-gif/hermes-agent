#!/bin/bash
# Temporary probe: how long the real signed v0.22.0 app's Squirrel.Mac takes from checkForUpdates
# to update-downloaded on the rc.4-v0.23.2 ZIP, on this runner. v0.22.0 gives up after 120 s.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
W="$RUNNER_TEMP/sq"
RUNS=${RUNS:-3}
mkdir -p "$W/app" "$W/feed" "$W/runs" "$W/npmhome"
now() { perl -MTime::HiRes=time -e 'printf "%.1f", time'; }
echo "host: $(sysctl -n machdep.cpu.brand_string) ncpu=$(sysctl -n hw.ncpu) mem=$(( $(sysctl -n hw.memsize) / 1073741824 ))GB macOS $(sw_vers -productVersion)"
df -h "$RUNNER_TEMP" | tail -1

B=https://hermes-assets.nousresearch.com/releases/tag
curl -fsSL --retry 3 -o "$W/old.zip" "$B/rc.3-v0.22.0/HermesBundled-0.22.0-mac-arm64.zip"
curl -fsSL --retry 3 -o "$W/feed/rc4.zip" "$B/rc.4-v0.23.2/HermesBundled-0.23.2-mac-arm64.zip"
[ "$(stat -f %z "$W/old.zip")" = 1583117114 ] && [ "$(stat -f %z "$W/feed/rc4.zip")" = 973295677 ] || { echo "unexpected asset size"; exit 1; }

ditto -x -k "$W/old.zip" "$W/app/"
APP="$W/app/Hermes Agent.app"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --verify --deep --strict "$APP"
echo "OLD $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist"), signature valid"
TOOLS="$APP/Contents/Resources/agent-payload/tools"
NODE="$(ls -d "$TOOLS"/node-*/bin/node | head -1)"
NPM="$(find "$TOOLS" -name npm-cli.js -path '*/bin/*' | head -1)"
HOME="$W/npmhome" "$NODE" "$NPM" install --prefix "$W/drv" playwright-core@1.64.0 --no-audit --no-fund --loglevel=error

# Squirrel unzips with ditto; this times that part alone.
for i in 1 2; do
  rm -rf "$W/x"; s=$(now)
  ditto -x -k "$W/feed/rc4.zip" "$W/x"
  echo "RESULT ditto run=$i seconds=$(echo "$(now) - $s" | bc)"
done
rm -rf "$W/x"

for i in $(seq 1 "$RUNS"); do
  root="$W/runs/rc4-$i"
  mkdir -p "$root/app"
  cp -c -R "$APP" "$root/app/"
  rm -f "$W/feed/port"
  "$NODE" "$HERE/serve.cjs" "$W/feed" "$root/requests.jsonl" & server=$!
  for _ in $(seq 1 50); do [ -s "$W/feed/port" ] && break; sleep 0.2; done
  NODE_PATH="$W/drv/node_modules" "$NODE" "$HERE/drive.cjs" "$root/app/Hermes Agent.app/Contents/MacOS/Hermes Agent" \
    "http://127.0.0.1:$(cat "$W/feed/port")/feed/rc4" "$root" "$root/result.json" > "$root/drive.log" 2>&1 || true
  kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true
  python3 -I -c 'import json,sys; r=json.load(open(sys.argv[1])); print(f"RESULT squirrel run={sys.argv[2]} seconds={r[\"seconds\"]} outcome={r[\"outcome\"][\"event\"]} electron={r[\"electron\"]}")' \
    "$root/result.json" "$i" || { echo "RESULT squirrel run=$i no result"; tail -5 "$root/drive.log"; }
  # Let ShipIt finish installing into the clone before the next run reuses its job label.
  for _ in $(seq 1 60); do launchctl list 2>/dev/null | grep -q 'hermes-bundled.ShipIt' || break; sleep 5; done
  echo "clone version after run: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$root/app/Hermes Agent.app/Contents/Info.plist")"
  rm -rf "$root/app"
done
