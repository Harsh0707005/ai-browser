const fs = require('fs')
const path = require('path')

function getPageStyles() {
  const stylePath = path.join(__dirname, 'injected-styles.css')
  return fs.readFileSync(stylePath, 'utf8')
}

module.exports = { getPageStyles }
