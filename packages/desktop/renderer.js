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
const tabList = document.getElementById('tabList')
const newTabBtn = document.getElementById('newTabBtn')

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
    pendingRequests[requestId] = { resolve, reject }
    ws.send(JSON.stringify(msg))

    setTimeout(() => {
      if (pendingRequests[requestId]) {
        delete pendingRequests[requestId]
        reject(new Error('Request timeout'))
      }
    }, 30000)
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
  if (window.electronAPI) window.electronAPI.sidebarToggled(sidebarOpen)
}

function openSidebarAndFocus() {
  if (!sidebarOpen) {
    sidebarOpen = true
    sidebar.classList.add('open')
    if (window.electronAPI) window.electronAPI.sidebarToggled(true)
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

function addMessage(text, type) {
  const div = document.createElement('div')
  div.className = 'chat-message ' + type
  if (type === 'assistant') {
    div.classList.add('markdown')
    div.innerHTML = renderMarkdown(text)
  } else {
    div.textContent = text
  }
  chatMessages.appendChild(div)
  smoothScrollToBottom()
  return div
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
    agentTabIds.forEach(id => window.electronAPI.closeTab(id))
    agentTabIds.clear()
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
  const message = chatInput.value.trim()
  if (!message || agentRunning) return

  agentAbortRequested = false
  activeUserQuery = message
  activeFindings = []
  setInputEnabled(false)
  chatInput.value = ''

  conversationHistory.push({ role: 'user', content: message })
  addMessage(message, 'user')
  addMessage('Planning...', 'loading')

  try {
    const conversationContext = await getContextForPlan()
    const planResult = await sendRequest({ type: 'plan', message, conversationContext })

    removeLastLoading()

    if (agentAbortRequested) return
    if (!planResult.success || !planResult.plan) {
      addMessage(planResult.error || 'Failed to create plan', 'error')
      setInputEnabled(true)
      return
    }

    const planId = addPlanDisplay(planResult.plan)

    await executeAgentPlan(planResult.plan, planId)
  } catch (error) {
    removeLastLoading()
    addMessage('Error: ' + error.message, 'error')
  } finally {
    agentAbortRequested = false
    if (window.electronAPI) {
      agentTabIds.forEach(id => window.electronAPI.stopAgentControl(id))
    }
    agentTabIds.clear()
    updateAgentOverlay()
  }

  setInputEnabled(true)
}

async function executeSingleStep(plan, stepIndex, tabId, planId) {
  if (agentAbortRequested) return
  updateStep(stepIndex, 'active', '', planId)

  let stepComplete = false
  let actionCount = 0
  const actionsTakenThisStep = []

  while (!stepComplete && actionCount < MAX_ACTIONS_PER_STEP) {
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
    updateStep(stepIndex, 'completed', 'Max actions reached, moving on', planId)
  }
}

async function executeAgentPlan(plan, planId = activePlanId) {
  const groups = groupStepsByGroup(plan.steps)
  let sequentialTabId = null

  for (const group of groups) {
    if (agentAbortRequested) return
    const isParallel = group.length > 1

    if (!isParallel) {
      if (!sequentialTabId) {
        sequentialTabId = await window.electronAPI.createAgentTab()
        agentTabIds.add(sequentialTabId)
      }
      await executeSingleStep(plan, group[0].originalIndex, sequentialTabId, planId)
    } else {
      const tabIds = await Promise.all(
        group.map((_, i) => window.electronAPI.createAgentTab(null, i > 0))
      )
      tabIds.forEach(id => agentTabIds.add(id))

      await Promise.all(
        group.map((step, i) => executeSingleStep(plan, step.originalIndex, tabIds[i], planId))
      )
    }
  }

  let summary = plan.goal + '. Done.'
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
    } else if (finalUrl) {
      try {
        summary = `You're on ${new URL(finalUrl).hostname} now. What would you like to do?`
      } catch (_) {}
    }
  } catch (_) {}
  conversationHistory.push({ role: 'assistant', content: summary })
  collapsePlanWithSummary(summary, planId)
  addMessage(summary, 'assistant')
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
