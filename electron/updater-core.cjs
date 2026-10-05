// Pure helpers (no electron imports) so they can be unit tested.
const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}
const pickAsset = (assets, platform, arch) => {
  if (platform === 'darwin') return assets.find((a) => a.name.endsWith(`mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`))
  if (platform === 'win32') return assets.find((a) => /win-setup\.exe$/.test(a.name))
  return null
}
// Run after the app quits: wait for the old process to exit, swap the bundle, strip quarantine, relaunch.
const MAC_SWAP_SCRIPT = `#!/bin/bash
PID="$1"; NEW="$2"; DEST="$3"
for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.3; done
rm -rf "$DEST.old"
if mv "$DEST" "$DEST.old"; then
  if ditto "$NEW" "$DEST"; then
    xattr -cr "$DEST" 2>/dev/null
    rm -rf "$DEST.old"
  else
    rm -rf "$DEST"; mv "$DEST.old" "$DEST"
  fi
fi
open "$DEST"
`
module.exports = { newer, pickAsset, MAC_SWAP_SCRIPT }
