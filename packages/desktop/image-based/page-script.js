const fs = require('fs')
const path = require('path')
const selectors = require('./selectors')

function getPageScript() {
  const scriptPath = path.join(__dirname, 'injected-analyzer.js')
  const raw = fs.readFileSync(scriptPath, 'utf8')
  const selectorList = JSON.stringify(selectors)
  return raw.replace('__SELECTORS_PLACEHOLDER__', selectorList)
}

module.exports = { getPageScript }
