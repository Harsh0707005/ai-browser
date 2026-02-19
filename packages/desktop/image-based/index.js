const path = require('path')
const { getPageScript } = require('./page-script')
const { getPageStyles } = require('./page-styles')

function injectClickableOverlays(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  const css = getPageStyles()
  const script = getPageScript()
  try {
    webContents.insertCSS(css)
    webContents.executeJavaScript(script).catch(() => {})
  } catch (e) {}
}

module.exports = { injectClickableOverlays }
