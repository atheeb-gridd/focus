// Ad-hoc sign the mac app so the bundle seal is valid after electron-builder edits it.
// Without this, Apple Silicon Macs report the app as "damaged". Real fix for the
// "unidentified developer" prompt is an Apple Developer ID + notarization.
const { execSync } = require('child_process')
const path = require('path')
exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'darwin') return
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' })
}
