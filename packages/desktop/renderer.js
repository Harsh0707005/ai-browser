const addressInput = document.getElementById('addressInput')
const backBtn = document.getElementById('backBtn')
const forwardBtn = document.getElementById('forwardBtn')
const reloadBtn = document.getElementById('reloadBtn')
const loadingIndicator = document.getElementById('loadingIndicator')
const sidebar = document.getElementById('sidebar')
const sidebarToggle = document.getElementById('sidebarToggle')
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn')
const chatInput = document.getElementById('chatInput')
const chatSendBtn = document.getElementById('chatSendBtn')
const chatMessages = document.getElementById('chatMessages')
const modelSelect = document.getElementById('modelSelect')
const tabList = document.getElementById('tabList')
const newTabBtn = document.getElementById('newTabBtn')
const sidebarResizeHandle = document.getElementById('sidebarResizeHandle')
const settingsBtn = document.getElementById('settingsBtn')
const settingsOverlay = document.getElementById('settingsOverlay')
const settingsCloseBtn = document.getElementById('settingsCloseBtn')
const savedLoginsList = document.getElementById('savedLoginsList')
const savedLoginsEmpty = document.getElementById('savedLoginsEmpty')

const SIDEBAR_MIN_WIDTH = 280
const SIDEBAR_MAX_WIDTH = 700
const SIDEBAR_DEFAULT_WIDTH = 400

function getSelectedModel() {
  return (modelSelect && modelSelect.value) || 'gemini'
}

let currentUrl = 'https://www.google.com'
let tabsState = []
let activeTabId = null
let sidebarOpen = false
let agentRunning = false
let agentAbortRequested = false
const MAX_ACTIONS_PER_STEP = 5
const WS_URL = 'ws://localhost:3001'

let planRunCounter = 0
let activePlanId = null
let activeUserQuery = ''
let activeFindings = []

const MAX_CONTEXT_CHARS = 5500
let conversationHistory = []
let conversationSummary = ''
let summarizedUpToIndex = 0

let ws = null
let wsReady = false
let pendingRequests = {}
let requestCounter = 0

function connectWS() {
  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    wsReady = true
  }

  ws.onclose = () => {
    wsReady = false
    setTimeout(connectWS, 2000)
  }

  ws.onerror = () => {}

  ws.onmessage = (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch (e) { return }

    if (msg.requestId && pendingRequests[msg.requestId]) {
      pendingRequests[msg.requestId].resolve(msg)
      delete pendingRequests[msg.requestId]
    }
  }
}

function sendRequest(msg) {
  return new Promise((resolve, reject) => {
    if (!wsReady || !ws) {
      return reject(new Error('Not connected to backend'))
    }
    const requestId = ++requestCounter
    msg.requestId = requestId
    msg.model = getSelectedModel()
    msg.clientDateTime = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })
    pendingRequests[requestId] = { resolve, reject }
    ws.send(JSON.stringify(msg))

    const timeoutMs = msg.type === 'plan' ? 180000 : 30000
    setTimeout(() => {
      if (pendingRequests[requestId]) {
        delete pendingRequests[requestId]
        reject(new Error('Request timeout'))
      }
    }, timeoutMs)
  })
}

connectWS()

addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const url = addressInput.value.trim()
    if (url) navigate(url)
  }
})

backBtn.addEventListener('click', (e) => {
  e.preventDefault()
  if (window.electronAPI && !backBtn.disabled) window.electronAPI.goBack()
})

forwardBtn.addEventListener('click', (e) => {
  e.preventDefault()
  if (window.electronAPI && !forwardBtn.disabled) window.electronAPI.goForward()
})

reloadBtn.addEventListener('click', () => { if (window.electronAPI) window.electronAPI.reload() })
sidebarToggle.addEventListener('click', () => { toggleSidebar() })
sidebarCloseBtn.addEventListener('click', () => { toggleSidebar() })

// ── Settings / Saved passwords ─────────────────────────────────────────────
function openSettings() {
  if (!settingsOverlay) return
  if (window.electronAPI) window.electronAPI.hideBrowserView()
  settingsOverlay.setAttribute('aria-hidden', 'false')
  loadSavedLogins()
}

function closeSettings() {
  if (!settingsOverlay) return
  settingsOverlay.setAttribute('aria-hidden', 'true')
  if (window.electronAPI) window.electronAPI.showBrowserView()
}

async function loadSavedLogins() {
  if (!savedLoginsList || !savedLoginsEmpty) return
  if (!window.electronAPI || !window.electronAPI.getAllCredentials) {
    savedLoginsList.innerHTML = ''
    savedLoginsEmpty.style.display = 'block'
    return
  }
  const store = await window.electronAPI.getAllCredentials()
  const domains = Object.keys(store).filter(d => store[d] && store[d].length > 0)
  savedLoginsList.innerHTML = ''
  if (domains.length === 0) {
    savedLoginsEmpty.style.display = 'block'
    return
  }
  savedLoginsEmpty.style.display = 'none'
  for (const domain of domains) {
    const domainLabel = document.createElement('div')
    domainLabel.className = 'saved-login-domain'
    domainLabel.textContent = domain
    savedLoginsList.appendChild(domainLabel)
    for (const cred of store[domain]) {
      const item = document.createElement('div')
      item.className = 'saved-login-item'
      item.dataset.domain = domain
      item.dataset.credentialId = cred.id || ''
      const meta = cred.fieldMeta || []

      // ── View mode ─────────────────────────────────────────────────────
      const viewWrap = document.createElement('div')
      viewWrap.className = 'saved-login-view'
      const info = document.createElement('div')
      info.className = 'saved-login-info'
      const label = document.createElement('div')
      label.className = 'saved-login-label'
      label.textContent = cred.label || domain
      info.appendChild(label)
      const fieldsEl = document.createElement('div')
      fieldsEl.className = 'saved-login-fields'
      meta.forEach(f => {
        const fieldWrap = document.createElement('div')
        fieldWrap.className = 'saved-login-field'
        const nameSpan = document.createElement('span')
        nameSpan.textContent = (f.label || f.name) + ': '
        const valueSpan = document.createElement('span')
        valueSpan.className = 'saved-login-field-value'
        valueSpan.textContent = f.isPassword ? '••••••••' : (cred.fields[f.name] || '—')
        valueSpan.dataset.isPassword = f.isPassword ? '1' : '0'
        valueSpan.dataset.value = cred.fields[f.name] || ''
        fieldWrap.appendChild(nameSpan)
        fieldWrap.appendChild(valueSpan)
        fieldsEl.appendChild(fieldWrap)
      })
      info.appendChild(fieldsEl)
      const actions = document.createElement('div')
      actions.className = 'saved-login-actions'
      const showBtn = document.createElement('button')
      showBtn.className = 'saved-login-btn'
      showBtn.type = 'button'
      showBtn.title = 'Show password'
      showBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      showBtn.addEventListener('click', () => {
        const values = item.querySelectorAll('.saved-login-field-value[data-is-password="1"]')
        const first = values[0]
        const isRevealed = first && first.classList.contains('revealed')
        values.forEach(v => {
          v.classList.toggle('revealed', !isRevealed)
          v.textContent = isRevealed ? '••••••••' : (v.dataset.value || '')
        })
        showBtn.title = isRevealed ? 'Show password' : 'Hide password'
      })
      const editBtn = document.createElement('button')
      editBtn.className = 'saved-login-btn edit'
      editBtn.type = 'button'
      editBtn.title = 'Edit'
      editBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      editBtn.addEventListener('click', () => {
        item.classList.add('editing')
        const firstInput = item.querySelector('.saved-login-edit-input')
        if (firstInput) firstInput.focus()
      })
      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'saved-login-btn delete'
      deleteBtn.type = 'button'
      deleteBtn.title = 'Remove'
      deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
      deleteBtn.addEventListener('click', async () => {
        if (!window.electronAPI || !window.electronAPI.deleteCredential) return
        const ok = await window.electronAPI.deleteCredential(domain, cred.id)
        if (ok) loadSavedLogins()
      })
      actions.appendChild(showBtn)
      actions.appendChild(editBtn)
      actions.appendChild(deleteBtn)
      viewWrap.appendChild(info)
      viewWrap.appendChild(actions)
      item.appendChild(viewWrap)

      // ── Edit mode ─────────────────────────────────────────────────────
      const editWrap = document.createElement('div')
      editWrap.className = 'saved-login-edit'
      const labelRow = document.createElement('div')
      labelRow.className = 'saved-login-edit-row'
      const labelLabel = document.createElement('label')
      labelLabel.textContent = 'Label (e.g. username or email)'
      const labelInput = document.createElement('input')
      labelInput.type = 'text'
      labelInput.className = 'saved-login-edit-input'
      labelInput.placeholder = 'Login label'
      labelInput.value = cred.label || ''
      labelRow.appendChild(labelLabel)
      labelRow.appendChild(labelInput)
      editWrap.appendChild(labelRow)
      const editInputs = []
      meta.forEach(f => {
        const row = document.createElement('div')
        row.className = 'saved-login-edit-row'
        const lab = document.createElement('label')
        lab.textContent = f.label || f.name
        const inp = document.createElement('input')
        inp.className = 'saved-login-edit-input'
        inp.type = f.isPassword ? 'password' : 'text'
        inp.placeholder = f.isPassword ? '••••••••' : (f.label || f.name)
        inp.value = cred.fields[f.name] || ''
        inp.dataset.fieldName = f.name
        row.appendChild(lab)
        row.appendChild(inp)
        editWrap.appendChild(row)
        editInputs.push({ name: f.name, input: inp })
      })
      const editActions = document.createElement('div')
      editActions.className = 'saved-login-edit-actions'
      const saveBtn = document.createElement('button')
      saveBtn.className = 'saved-login-btn save'
      saveBtn.type = 'button'
      saveBtn.textContent = 'Save'
      saveBtn.addEventListener('click', async () => {
        const newLabel = labelInput.value.trim() || cred.label || domain
        const newFields = {}
        editInputs.forEach(({ name, input }) => { newFields[name] = input.value })
        const updated = {
          id: cred.id,
          label: newLabel,
          fields: newFields,
          fieldMeta: cred.fieldMeta
        }
        if (window.electronAPI && window.electronAPI.saveCredential) {
          await window.electronAPI.saveCredential(domain, updated)
          item.classList.remove('editing')
          loadSavedLogins()
        }
      })
      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'saved-login-btn'
      cancelBtn.type = 'button'
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => {
        item.classList.remove('editing')
      })
      editActions.appendChild(saveBtn)
      editActions.appendChild(cancelBtn)
      editWrap.appendChild(editActions)
      item.appendChild(editWrap)

      savedLoginsList.appendChild(item)
    }
  }
}

const toolbarEl = document.querySelector('.toolbar')
if (toolbarEl) toolbarEl.addEventListener('click', (e) => { if (e.target.closest('#settingsBtn')) { e.preventDefault(); openSettings() } })
if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings)
if (settingsOverlay) settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings() })

let sidebarResizing = false
let sidebarResizeStartX = 0
let sidebarResizeStartWidth = SIDEBAR_DEFAULT_WIDTH

function getSidebarWidth() {
  const v = sidebar.style.getPropertyValue('--sidebar-width') || getComputedStyle(sidebar).getPropertyValue('--sidebar-width')
  const num = parseInt(v, 10)
  return isNaN(num) ? SIDEBAR_DEFAULT_WIDTH : num
}

function setSidebarWidth(w) {
  const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w))
  sidebar.style.setProperty('--sidebar-width', clamped + 'px')
  if (sidebarOpen && window.electronAPI) window.electronAPI.sidebarWidthChanged(clamped)
}

sidebarResizeHandle.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  e.preventDefault()
  sidebarResizing = true
  sidebarResizeStartX = e.clientX
  sidebarResizeStartWidth = getSidebarWidth()
  sidebarResizeHandle.classList.add('resizing')
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  const onMove = (e) => {
    const dx = sidebarResizeStartX - e.clientX
    setSidebarWidth(sidebarResizeStartWidth + dx)
  }
  const onUp = () => {
    sidebarResizing = false
    sidebarResizeHandle.classList.remove('resizing')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
})

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChatMessage()
  }
})

chatSendBtn.addEventListener('click', () => {
  if (agentRunning) stopAgent()
  else sendChatMessage()
})

function toggleSidebar() {
  sidebarOpen = !sidebarOpen
  sidebar.classList.toggle('open', sidebarOpen)
  if (sidebarOpen) chatInput.focus()
  if (window.electronAPI) {
    window.electronAPI.sidebarToggled(sidebarOpen)
    window.electronAPI.sidebarWidthChanged(sidebarOpen ? getSidebarWidth() : 0)
  }
}

function openSidebarAndFocus() {
  if (!sidebarOpen) {
    sidebarOpen = true
    sidebar.classList.add('open')
    if (window.electronAPI) {
      window.electronAPI.sidebarToggled(true)
      window.electronAPI.sidebarWidthChanged(getSidebarWidth())
    }
  }
  chatInput.focus()
}

let lastMetaKeyTime = 0
document.addEventListener('keydown', (e) => {
  if (e.key === 'Meta') {
    const now = Date.now()
    if (now - lastMetaKeyTime < 400) {
      e.preventDefault()
      e.stopPropagation()
      openSidebarAndFocus()
      lastMetaKeyTime = 0
      return
    }
    lastMetaKeyTime = now
  }
})

if (window.electronAPI) {
  window.electronAPI.onOpenSidebar(() => openSidebarAndFocus())
}

function formatTurns(turns) {
  if (!turns || !turns.length) return ''
  return turns.map(t => (t.role === 'user' ? 'User' : 'Assistant') + ': ' + (t.content || '').trim()).join('\n')
}

async function getContextForPlan() {
  const previousTurns = conversationHistory.slice(summarizedUpToIndex, -1)
  let formatted = formatTurns(previousTurns)
  const summaryPrefix = conversationSummary ? 'Summary of earlier conversation:\n' + conversationSummary + '\n\n' : ''
  let totalLen = summaryPrefix.length + (formatted ? 'Recent conversation:\n'.length + formatted.length : 0)

  while (totalLen > MAX_CONTEXT_CHARS && summarizedUpToIndex < conversationHistory.length - 1) {
    const end = Math.min(summarizedUpToIndex + 2, conversationHistory.length - 1)
    const batch = conversationHistory.slice(summarizedUpToIndex, end)
    if (batch.length === 0) break
    try {
      const result = await sendRequest({ type: 'summarize_conversation', messages: batch })
      if (result.success && result.summary) {
        conversationSummary = conversationSummary ? conversationSummary + '\n' + result.summary : result.summary
      }
    } catch (_) {}
    summarizedUpToIndex += batch.length
    const rest = conversationHistory.slice(summarizedUpToIndex, -1)
    formatted = formatTurns(rest)
    const newPrefix = conversationSummary ? 'Summary of earlier conversation:\n' + conversationSummary + '\n\n' : ''
    totalLen = newPrefix.length + (formatted ? 'Recent conversation:\n'.length + formatted.length : 0)
  }

  if (!summaryPrefix && !formatted) return ''
  return (summaryPrefix ? summaryPrefix + (formatted ? 'Recent conversation:\n' + formatted : '') : 'Recent conversation:\n' + formatted).trim()
}

function escapeHTML(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeLinkHref(href) {
  const s = String(href || '').trim()
  if (!s) return null
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return null
}

// Minimal markdown renderer (safe):
// - escapes all HTML first
// - supports: headings (#/##/###), lists (-), links [text](http...), bold/italic, inline code, fenced code blocks
function renderMarkdown(md) {
  const src = String(md || '')

  // Extract fenced code blocks first so we don't accidentally format inside them.
  const codeBlocks = []
  const placeholder = (i) => `@@CODEBLOCK_${i}@@`
  let text = src.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const langNorm = (lang || '').trim().toLowerCase()
    if (langNorm === 'table-json' || langNorm === 'json') {
      try {
        const data = JSON.parse(code.trim())
        if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
          const thCells = data.columns.map(c => '<th>' + escapeHTML(String(c)) + '</th>').join('')
          const trRows = data.rows.map(row =>
            '<tr>' + (Array.isArray(row) ? row : []).map(cell => '<td>' + escapeHTML(String(cell)) + '</td>').join('') + '</tr>'
          ).join('')
          const tableHtml = '<div class="chat-table-wrap"><table class="chat-table"><thead><tr>' + thCells + '</tr></thead><tbody>' + trRows + '</tbody></table></div>'
          const idx = codeBlocks.push(tableHtml) - 1
          return placeholder(idx)
        }
      } catch (e) {}
    }
    const escaped = escapeHTML(code)
    const klass = lang ? ` class="language-${escapeHTML(lang)}"` : ''
    const html = `<pre><code${klass}>${escaped}</code></pre>`
    const idx = codeBlocks.push(html) - 1
    return placeholder(idx)
  })

  // Escape remaining text (prevents HTML injection).
  text = escapeHTML(text)

  // Headings (cap at h3 for chat).
  text = text
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h3>$1</h3>')

  // Links: [label](url) where url is http(s) only.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safe = safeLinkHref(href)
    if (!safe) return label
    return `<a href="${escapeHTML(safe)}" target="_blank" rel="noreferrer noopener">${label}</a>`
  })

  // Inline code.
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold / italic (simple).
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  // Lists: consecutive "- " lines become a <ul>.
  const lines = text.split('\n')
  let out = ''
  let inList = false
  for (const line of lines) {
    const m = line.match(/^\s*-\s+(.*)$/)
    if (m) {
      if (!inList) { out += '<ul>'; inList = true }
      out += `<li>${m[1]}</li>`
    } else {
      if (inList) { out += '</ul>'; inList = false }
      out += line + '\n'
    }
  }
  if (inList) out += '</ul>'
  text = out

  // Paragraphs / line breaks.
  text = text
    .split(/\n{2,}/)
    .map(block => {
      const b = block.trim()
      if (!b) return ''
      if (b.startsWith('<ul>') || b.startsWith('<h3>') || b.startsWith('<pre>')) return b
      // Convert single newlines within a paragraph to <br>
      return `<p>${b.replace(/\n/g, '<br>')}</p>`
    })
    .filter(Boolean)
    .join('')

  // Re-insert fenced code blocks.
  text = text.replace(/@@CODEBLOCK_(\d+)@@/g, (_, i) => codeBlocks[Number(i)] || '')

  return text
}

function addMessage(text, type, reference) {
  const div = document.createElement('div')
  div.className = 'chat-message ' + type
  if (type === 'assistant') {
    div.classList.add('markdown')
    div.innerHTML = renderMarkdown(text)
  } else {
    div.textContent = text
  }
  if (reference && type === 'user') {
    const tag = document.createElement('div')
    tag.className = 'chat-reference-tag'
    const truncated = reference.length > 200 ? reference.substring(0, 200) + '...' : reference
    tag.textContent = truncated
    div.appendChild(tag)
  }
  chatMessages.appendChild(div)
  smoothScrollToBottom()
  return div
}

const SERVICE_ICON_COLORS = {
  'Gmail': '#EA4335',
  'Google Calendar': '#4285F4',
  'Google Docs': '#4285F4',
  'Google Sheets': '#0F9D58',
  'Google Drive': '#34A853',
  'Google Meet': '#00897B',
  'YouTube': '#FF0000',
}

function addConnectionCard(serviceLabel, redirectUrl, pendingMessage, pendingContext) {
  const card = document.createElement('div')
  card.className = 'chat-message connection-card'

  // ── Header: icon + title ──────────────────────────────────────────────────
  const header = document.createElement('div')
  header.className = 'connection-card-header'

  const iconEl = document.createElement('div')
  iconEl.className = 'connection-card-icon'
  iconEl.style.background = SERVICE_ICON_COLORS[serviceLabel] || '#1a73e8'
  iconEl.textContent = serviceLabel.charAt(0)

  const titleEl = document.createElement('div')
  titleEl.className = 'connection-card-title'
  titleEl.textContent = `Connect ${serviceLabel}`

  header.appendChild(iconEl)
  header.appendChild(titleEl)

  // ── Description ───────────────────────────────────────────────────────────
  const descEl = document.createElement('div')
  descEl.className = 'connection-card-desc'
  descEl.textContent = `Sign in to your ${serviceLabel} account to continue. Click Connect, complete the sign-in in your browser, then click Continue.`

  // ── Buttons ───────────────────────────────────────────────────────────────
  const actions = document.createElement('div')
  actions.className = 'connection-card-actions'

  const connectBtn = document.createElement('button')
  connectBtn.className = 'connection-card-btn connect'
  connectBtn.type = 'button'
  connectBtn.textContent = `Connect ${serviceLabel}`
  connectBtn.addEventListener('click', () => {
    window.open(redirectUrl, '_blank')
    statusEl.textContent = 'Complete the sign-in in your browser, then click Continue.'
    statusEl.className = 'connection-card-status'
  })

  const continueBtn = document.createElement('button')
  continueBtn.className = 'connection-card-btn continue'
  continueBtn.type = 'button'
  continueBtn.textContent = 'Continue'

  continueBtn.addEventListener('click', async () => {
    connectBtn.disabled = true
    continueBtn.disabled = true
    statusEl.textContent = 'Checking connection...'
    statusEl.className = 'connection-card-status'
    setInputEnabled(false)

    let closeTabsOnFinish = false
    try {
      const planResult = await sendRequest({ type: 'plan', message: pendingMessage, conversationContext: pendingContext })

      if (planResult.needsConnection) {
        statusEl.textContent = 'Not connected yet — complete the sign-in and try again.'
        statusEl.className = 'connection-card-status error'
        connectBtn.disabled = false
        continueBtn.disabled = false
        setInputEnabled(true)
        return
      }

      card.remove()

      if (!planResult.success) {
        addMessage(planResult.error || 'Failed to process request', 'error')
        return
      }

      if (planResult.direct) {
        const reply = planResult.response || ''
        conversationHistory.push({ role: 'assistant', content: reply })
        addMessage(reply, 'assistant')
        return
      }

      if (planResult.plan) {
        const planId = addPlanDisplay(planResult.plan)
        const executionResult = await executeAgentPlan(planResult.plan, planId)
        if (executionResult && typeof executionResult.closeTabs === 'boolean') {
          closeTabsOnFinish = executionResult.closeTabs
        }
      }
    } catch (e) {
      statusEl.textContent = 'Error: ' + e.message
      statusEl.className = 'connection-card-status error'
      connectBtn.disabled = false
      continueBtn.disabled = false
    } finally {
      agentAbortRequested = false
      if (window.electronAPI) {
        agentTabIds.forEach(id => {
          window.electronAPI.stopAgentControl(id)
          if (closeTabsOnFinish && ownedAgentTabIds.has(id)) window.electronAPI.closeTab(id)
        })
      }
      agentTabIds.clear()
      ownedAgentTabIds.clear()
      updateAgentOverlay()
      setInputEnabled(true)
    }
  })

  // ── Status line ───────────────────────────────────────────────────────────
  const statusEl = document.createElement('div')
  statusEl.className = 'connection-card-status'
  statusEl.textContent = 'Sign in to grant access, then click Continue.'

  actions.appendChild(connectBtn)
  actions.appendChild(continueBtn)

  card.appendChild(header)
  card.appendChild(descEl)
  card.appendChild(actions)
  card.appendChild(statusEl)

  chatMessages.appendChild(card)
  smoothScrollToBottom()
}

function smoothScrollToBottom() {
  requestAnimationFrame(() => {
    chatMessages.scrollTo({
      top: chatMessages.scrollHeight,
      behavior: 'smooth'
    })
  })
}

function addPlanDisplay(plan) {
  const planId = ++planRunCounter
  activePlanId = planId

  const container = document.createElement('div')
  container.className = 'plan-container'
  container.id = 'plan-' + planId

  const toggleRow = document.createElement('div')
  toggleRow.className = 'plan-toggle'
  toggleRow.setAttribute('role', 'button')
  toggleRow.setAttribute('tabindex', '0')

  const chevron = document.createElement('span')
  chevron.className = 'plan-chevron'
  chevron.innerHTML = '▼'
  toggleRow.appendChild(chevron)

  const summarySpan = document.createElement('span')
  summarySpan.className = 'plan-summary-text'
  summarySpan.textContent = plan.goal
  toggleRow.appendChild(summarySpan)

  container.appendChild(toggleRow)

  const stepsBody = document.createElement('div')
  stepsBody.className = 'plan-steps-body'

  const header = document.createElement('div')
  header.className = 'plan-header'
  header.textContent = plan.goal
  stepsBody.appendChild(header)

  const groupCounts = {}
  plan.steps.forEach(step => {
    const g = step.group || step.step
    groupCounts[g] = (groupCounts[g] || 0) + 1
  })

  plan.steps.forEach((step, i) => {
    const g = step.group || step.step
    const isParallel = groupCounts[g] > 1

    const stepDiv = document.createElement('div')
    stepDiv.className = 'plan-step pending' + (isParallel ? ' parallel' : '')
    stepDiv.id = 'plan-' + planId + '-step-' + i

    const indicator = document.createElement('div')
    indicator.className = 'step-indicator'
    indicator.textContent = step.step

    const label = document.createElement('div')
    label.className = 'step-label'
    label.textContent = step.description

    if (isParallel) {
      const badge = document.createElement('span')
      badge.className = 'parallel-badge'
      badge.textContent = 'parallel'
      label.appendChild(badge)
    }

    stepDiv.appendChild(indicator)
    stepDiv.appendChild(label)
    stepsBody.appendChild(stepDiv)
  })

  container.appendChild(stepsBody)

  toggleRow.addEventListener('click', () => {
    container.classList.toggle('collapsed')
    chevron.textContent = container.classList.contains('collapsed') ? '▶' : '▼'
  })
  toggleRow.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      container.classList.toggle('collapsed')
      chevron.textContent = container.classList.contains('collapsed') ? '▶' : '▼'
    }
  })

  chatMessages.appendChild(container)
  smoothScrollToBottom()
  return planId
}

function collapsePlanWithSummary(summaryText, planId = activePlanId) {
  if (!planId) return
  const container = document.getElementById('plan-' + planId)
  if (!container) return
  const summaryEl = container.querySelector('.plan-summary-text')
  const chevron = container.querySelector('.plan-chevron')
  if (summaryEl) summaryEl.textContent = summaryText
  if (chevron) chevron.textContent = '▶'
  container.classList.add('collapsed')
}

function updateStep(stepIndex, status, detail, planId = activePlanId) {
  if (!planId) return
  const stepDiv = document.getElementById('plan-' + planId + '-step-' + stepIndex)
  if (!stepDiv) return
  stepDiv.className = 'plan-step ' + status
  if (detail) {
    let detailEl = stepDiv.querySelector('.step-detail')
    if (!detailEl) {
      detailEl = document.createElement('div')
      detailEl.className = 'step-detail'
      stepDiv.appendChild(detailEl)
    }
    detailEl.textContent = detail
  }
  smoothScrollToBottom()
}

function removeLastLoading() {
  const msgs = chatMessages.querySelectorAll('.chat-message.loading')
  if (msgs.length) msgs[msgs.length - 1].remove()
}

function setInputEnabled(enabled) {
  agentRunning = !enabled
  chatSendBtn.disabled = false
  chatInput.disabled = !enabled
  updateSendButtonState()
  if (enabled) chatInput.focus()
}

function updateSendButtonState() {
  const iconSend = chatSendBtn.querySelector('.chat-send-icon')
  const iconStop = chatSendBtn.querySelector('.chat-stop-icon')
  if (!iconSend || !iconStop) return
  if (agentRunning) {
    iconSend.style.display = 'none'
    iconStop.style.display = 'flex'
    chatSendBtn.classList.add('stop')
    chatSendBtn.title = 'Stop'
  } else {
    iconSend.style.display = 'flex'
    iconStop.style.display = 'none'
    chatSendBtn.classList.remove('stop')
    chatSendBtn.title = 'Send'
  }
}

function stopAgent() {
  agentAbortRequested = true
  if (window.electronAPI) {
    agentTabIds.forEach(id => {
      window.electronAPI.stopAgentControl(id)
      if (ownedAgentTabIds.has(id)) window.electronAPI.closeTab(id)
    })
    agentTabIds.clear()
    ownedAgentTabIds.clear()
    updateAgentOverlay()
  }
  setInputEnabled(true)
  addMessage('Stopped.', 'system')
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function actionLabel(data) {
  if (data.thought && data.thought.trim()) return data.thought.trim()
  if (data.action === 'navigate') return 'Opening page…'
  if (data.action === 'click') return 'Clicking…'
  if (data.action === 'type') return data.text ? `Typing "${data.text}"…` : 'Typing…'
  return 'Working…'
}

const agentTabIds = new Set()
const ownedAgentTabIds = new Set()

function groupStepsByGroup(steps) {
  const groupMap = new Map()
  steps.forEach((step, index) => {
    const groupId = step.group || (index + 1)
    if (!groupMap.has(groupId)) groupMap.set(groupId, [])
    groupMap.get(groupId).push({ ...step, originalIndex: index })
  })
  return [...groupMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, steps]) => steps)
}

async function sendChatMessage() {
  const rawMessage = chatInput.value.trim()
  if (!rawMessage || agentRunning) return

  let message = rawMessage
  let currentReference = null
  if (referenceText) {
    currentReference = referenceText
    message = 'User query: ' + rawMessage + '\n\nTagged reference context:\n"' + referenceText + '"'
    setReference('')
  }

  agentAbortRequested = false
  activeUserQuery = message
  activeFindings = []
  setInputEnabled(false)
  chatInput.value = ''

  conversationHistory.push({ role: 'user', content: message })
  addMessage(rawMessage, 'user', currentReference)
  addMessage('Planning...', 'loading')
  let closeTabsOnFinish = false

  try {
    const conversationContext = await getContextForPlan()
    const planResult = await sendRequest({ type: 'plan', message, conversationContext })

    removeLastLoading()

    if (agentAbortRequested) return
    if (!planResult.success) {
      addMessage(planResult.error || 'Failed to process request', 'error')
      setInputEnabled(true)
      return
    }

    if (planResult.needsConnection) {
      addConnectionCard(planResult.serviceLabel, planResult.redirectUrl, message, conversationContext)
      setInputEnabled(true)
      return
    }

    if (planResult.direct) {
      const reply = planResult.response || ''
      conversationHistory.push({ role: 'assistant', content: reply })
      addMessage(reply, 'assistant')
      setInputEnabled(true)
      return
    }

    if (!planResult.plan) {
      addMessage('Failed to create plan', 'error')
      setInputEnabled(true)
      return
    }

    const planId = addPlanDisplay(planResult.plan)

    const executionResult = await executeAgentPlan(planResult.plan, planId)
    if (executionResult && typeof executionResult.closeTabs === 'boolean') {
      closeTabsOnFinish = executionResult.closeTabs
    }
  } catch (error) {
    removeLastLoading()
    addMessage('Error: ' + error.message, 'error')
  } finally {
    agentAbortRequested = false
    if (window.electronAPI) {
      agentTabIds.forEach(id => {
        window.electronAPI.stopAgentControl(id)
        if (closeTabsOnFinish && ownedAgentTabIds.has(id)) window.electronAPI.closeTab(id)
      })
    }
    agentTabIds.clear()
    ownedAgentTabIds.clear()
    updateAgentOverlay()
  }

  setInputEnabled(true)
}

async function executeSingleStep(plan, stepIndex, tabId, planId, completedSteps) {
  if (agentAbortRequested) return
  if (completedSteps && completedSteps.has(stepIndex)) return
  updateStep(stepIndex, 'active', '', planId)

  let stepComplete = false
  let actionCount = 0
  const actionsTakenThisStep = []

  while (!stepComplete && actionCount < MAX_ACTIONS_PER_STEP) {
    if (agentAbortRequested) return
    await waitForCredModal()
    if (agentAbortRequested) return
    actionCount++
    await delay(500)

    const pageContext = await window.electronAPI.getPageContext(tabId)
    const currentURL = await window.electronAPI.getPageURL(tabId)

    let stepResult
    try {
      stepResult = await sendRequest({
        type: 'step',
        goal: plan.goal,
        plan: plan,
        stepIndex: stepIndex,
        pageContext: pageContext,
        currentURL: currentURL,
        actionsTakenThisStep: actionsTakenThisStep
      })
    } catch (error) {
      updateStep(stepIndex, 'error', error.message)
      return
    }

    if (!stepResult.success && !stepResult.action) {
      updateStep(stepIndex, 'error', stepResult.error || 'Failed')
      return
    }

    if (stepResult.action === 'done') {
      if (completedSteps) completedSteps.add(stepIndex)
      updateStep(stepIndex, 'completed', stepResult.thought || '', planId)
      if (stepResult.result && String(stepResult.result).trim()) {
        activeFindings.push({
          step: stepIndex + 1,
          url: currentURL || '',
          result: String(stepResult.result).trim()
        })
      } else if (stepResult.thought && String(stepResult.thought).trim()) {
        activeFindings.push({
          step: stepIndex + 1,
          url: currentURL || '',
          result: String(stepResult.thought).trim()
        })
      }
      stepComplete = true
      break
    }

    updateStep(stepIndex, 'active', actionLabel(stepResult), planId)

    const execResult = await window.electronAPI.executeAction(stepResult, tabId)

    if (!execResult.success) {
      updateStep(stepIndex, 'error', execResult.error || 'Action failed', planId)
      break
    }

    actionsTakenThisStep.push({
      action: stepResult.action,
      url: stepResult.url,
      elementId: stepResult.elementId,
      text: stepResult.text
    })

    await window.electronAPI.waitForLoad(tabId)
  }

  if (!stepComplete && actionCount >= MAX_ACTIONS_PER_STEP) {
    if (completedSteps) completedSteps.add(stepIndex)
    updateStep(stepIndex, 'completed', 'Max actions reached, moving on', planId)
  }
}

async function executeAgentPlan(plan, planId = activePlanId) {
  const groups = groupStepsByGroup(plan.steps)
  const completedSteps = new Set()
  const startFromCurrentTab = !!(plan && plan.execution && plan.execution.startFromCurrentTab)
  let sequentialTabId = null

  if (startFromCurrentTab && activeTabId && window.electronAPI) {
    sequentialTabId = activeTabId
    window.electronAPI.startAgentControl(sequentialTabId)
    agentTabIds.add(sequentialTabId)
    updateAgentOverlay()
  }

  for (const group of groups) {
    if (agentAbortRequested) return
    const isParallel = group.length > 1

    if (!isParallel) {
      const stepInfo = group[0]
      if (completedSteps.has(stepInfo.originalIndex)) continue
      if (!sequentialTabId) {
        sequentialTabId = await window.electronAPI.createAgentTab()
        agentTabIds.add(sequentialTabId)
        ownedAgentTabIds.add(sequentialTabId)
      }
      await executeSingleStep(plan, stepInfo.originalIndex, sequentialTabId, planId, completedSteps)
    } else {
      const n = group.length
      let tabIds
      if (sequentialTabId) {
        const extra = await Promise.all(
          Array.from({ length: n - 1 }, (_, i) => window.electronAPI.createAgentTab(null, i > 0))
        )
        tabIds = [sequentialTabId, ...extra]
        extra.forEach(id => {
          agentTabIds.add(id)
          ownedAgentTabIds.add(id)
        })
      } else {
        tabIds = await Promise.all(
          group.map((_, i) => window.electronAPI.createAgentTab(null, i > 0))
        )
        tabIds.forEach(id => {
          agentTabIds.add(id)
          ownedAgentTabIds.add(id)
        })
      }

      await Promise.all(
        group.map((step, i) => executeSingleStep(plan, step.originalIndex, tabIds[i], planId, completedSteps))
      )

      sequentialTabId = tabIds[0]
      for (let i = 1; i < tabIds.length; i++) {
        const id = tabIds[i]
        if (window.electronAPI) window.electronAPI.closeTab(id)
        agentTabIds.delete(id)
        ownedAgentTabIds.delete(id)
      }
      updateAgentOverlay()
    }
  }

  let summary = plan.goal + '. Done.'
  let closeTabs = false
  try {
    const anyTabId = [...agentTabIds][0] || null
    const finalUrl = anyTabId ? await window.electronAPI.getPageURL(anyTabId) : ''
    const finalPageContext = anyTabId ? await window.electronAPI.getPageContext(anyTabId) : null
    const summaryResult = await sendRequest({
      type: 'summary',
      userQuery: activeUserQuery || plan.goal,
      goal: plan.goal,
      finalURL: finalUrl || '',
      finalPageContext: finalPageContext || null,
      findings: activeFindings || [],
      plan: plan || null
    })
    if (summaryResult.success && summaryResult.summary) {
      summary = summaryResult.summary
      if (typeof summaryResult.closeTabs === 'boolean') closeTabs = summaryResult.closeTabs
    } else if (finalUrl) {
      try {
        summary = `You're on ${new URL(finalUrl).hostname} now. What would you like to do?`
      } catch (_) {}
    }
  } catch (_) {}
  conversationHistory.push({ role: 'assistant', content: summary })
  collapsePlanWithSummary(summary, planId)
  addMessage(summary, 'assistant')
  return { closeTabs }
}

function navigate(url) {
  if (window.electronAPI) {
    window.electronAPI.navigate(url)
    addressInput.blur()
  }
}

function updateAddressBar(url) {
  currentUrl = url
  addressInput.value = url
}

function updateNavigationButtons(canGoBack, canGoForward) {
  backBtn.disabled = !canGoBack
  forwardBtn.disabled = !canGoForward
}

function showLoading(show) {
  loadingIndicator.style.display = show ? 'block' : 'none'
}

if (window.electronAPI) {
  window.electronAPI.onNavigationStart(() => { showLoading(true) })

  window.electronAPI.onNavigationComplete((data) => {
    showLoading(false)
    updateAddressBar(data.url)
    if (data.canGoBack !== undefined) updateNavigationButtons(data.canGoBack, data.canGoForward)
  })

  window.electronAPI.onNavigationError(() => { showLoading(false) })

  window.electronAPI.onUrlChanged((data) => {
    if (typeof data === 'string') updateAddressBar(data)
    else {
      updateAddressBar(data.url)
      if (data.canGoBack !== undefined) updateNavigationButtons(data.canGoBack, data.canGoForward)
    }
  })

  window.electronAPI.onNavigationStateChanged((data) => {
    updateNavigationButtons(data.canGoBack, data.canGoForward)
  })
}

const referenceContainer = document.getElementById('referenceContainer')
let referenceText = ''

function setReference(text) {
  referenceText = text
  if (!text) {
    referenceContainer.innerHTML = ''
    referenceContainer.classList.remove('visible')
    return
  }
  referenceContainer.classList.add('visible')
  const truncated = text.length > 300 ? text.substring(0, 300) + '...' : text
  const chip = document.createElement('div')
  chip.className = 'reference-chip'
  const textDiv = document.createElement('div')
  textDiv.className = 'reference-text'
  textDiv.textContent = truncated
  const closeBtn = document.createElement('button')
  closeBtn.className = 'reference-close'
  closeBtn.innerHTML = '&times;'
  closeBtn.addEventListener('click', () => setReference(''))
  chip.appendChild(textDiv)
  chip.appendChild(closeBtn)
  referenceContainer.innerHTML = ''
  referenceContainer.appendChild(chip)
}

if (window.electronAPI) {
  window.electronAPI.onSelectionAction((data) => {
    if (data.type === 'summarize') {
      openSidebarAndFocus()
      chatInput.value = 'Summarize this:\n\n' + data.text
      sendChatMessage()
    } else if (data.type === 'ask') {
      setReference(data.text)
      openSidebarAndFocus()
      if (data.query) {
        chatInput.value = data.query
        sendChatMessage()
      }
    }
  })
}

const agentBorderOverlay = document.getElementById('agentBorderOverlay')
const agentToast = document.getElementById('agentToast')

function updateAgentOverlay() {
  const isOnAgentTab = agentTabIds.size > 0 && agentTabIds.has(activeTabId)
  agentBorderOverlay.classList.toggle('visible', isOnAgentTab)
  agentToast.classList.toggle('visible', isOnAgentTab)
}

function renderTabs() {
  tabList.innerHTML = ''
  tabsState.forEach(tab => {
    const el = document.createElement('div')
    let cls = 'tab'
    if (tab.id === activeTabId) cls += ' active'
    if (agentTabIds.has(tab.id)) cls += ' agent-tab'
    el.className = cls
    el.dataset.tabId = tab.id

    const title = document.createElement('span')
    title.className = 'tab-title'
    title.textContent = tab.title || 'New Tab'
    el.appendChild(title)

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      if (window.electronAPI) window.electronAPI.closeTab(tab.id)
    })
    el.appendChild(close)

    el.addEventListener('click', () => {
      if (window.electronAPI) window.electronAPI.switchTab(tab.id)
    })

    tabList.appendChild(el)
  })
  updateAgentOverlay()
}

newTabBtn.addEventListener('click', () => {
  if (window.electronAPI) window.electronAPI.createTab()
})

if (window.electronAPI) {
  window.electronAPI.onTabsUpdated((data) => {
    tabsState = data.tabs
    activeTabId = data.activeTabId
    renderTabs()
  })
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOverlay && settingsOverlay.getAttribute('aria-hidden') === 'false') {
    closeSettings()
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault()
    if (window.electronAPI) window.electronAPI.createTab()
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    e.preventDefault()
    if (activeTabId && window.electronAPI) window.electronAPI.closeTab(activeTabId)
  }
})

addressInput.value = currentUrl
if (window.electronAPI) setTimeout(() => { window.electronAPI.getNavigationState() }, 500)

// ── Credential modal pause gate ───────────────────────────────────────────────
// The modal is injected into BrowserView pages by main.js.
// While it is open, agent plan execution is paused here in the renderer.
let _credModalOpen = false
let _credModalResolvers = []

function waitForCredModal() {
  if (!_credModalOpen) return Promise.resolve()
  return new Promise(resolve => _credModalResolvers.push(resolve))
}

if (window.electronAPI) {
  window.electronAPI.onCredModalOpen(() => { _credModalOpen = true })
  window.electronAPI.onCredModalClosed(() => {
    _credModalOpen = false
    _credModalResolvers.forEach(r => r())
    _credModalResolvers = []
  })
}
