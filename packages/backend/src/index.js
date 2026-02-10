import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";

dotenv.config()

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

const PORT = process.env.PORT ?? 3001
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env file')
}

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null

app.use(express.json())
app.get("/health", (req, res) => { return res.send({ message: "healthy" }) })

function parseGeminiJSON(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch (e) {}
  const match = text.match(/\{[\s\S]*\}/)
  if (match) { try { return JSON.parse(match[0]) } catch (e) {} }
  return null
}

async function callGemini(prompt) {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    generationConfig: { responseMimeType: 'application/json' }
  })
  return response.text
}

function formatElements(elements) {
  if (!elements || !elements.length) return '(no interactive elements found)'
  return elements.map(el => {
    let parts = [`[${el.id}] <${el.tag}>`]
    if (el.type) parts.push(`type=${el.type}`)
    if (el.name) parts.push(`name=${el.name}`)
    if (el.elementId) parts.push(`id=${el.elementId}`)
    if (el.role) parts.push(`role=${el.role}`)
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`)
    if (el.value) parts.push(`value="${el.value}"`)
    if (el.href) parts.push(`href="${el.href}"`)
    if (el.text) parts.push(`text="${el.text}"`)
    if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`)
    if (el.title) parts.push(`title="${el.title}"`)
    return parts.join(' ')
  }).join('\n')
}

async function handleSummarizeConversation(messages) {
  if (!ai) return { success: false, error: "Gemini API not configured" }
  if (!Array.isArray(messages) || messages.length === 0) return { success: true, summary: '' }

  const transcript = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').trim()}`).join('\n')
  const prompt = `Summarize this browser-assistant conversation in 2-4 short sentences. Keep: what the user wanted to do, what was done, any follow-up question the assistant asked, and where things were left off. Plain text only, no bullets.

Conversation:
${transcript}`

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt
    })
    const summary = (response.text || '').trim()
    console.log('[SUMMARIZE]', summary ? summary.substring(0, 80) + '...' : '(empty)')
    return { success: true, summary }
  } catch (error) {
    console.error('[SUMMARIZE] Error:', error.message)
    return { success: false, error: error.message }
  }
}

async function handlePlan(message, conversationContext) {
  if (!ai) return { success: false, error: "Gemini API not configured" }

  console.log(`[PLAN] "${message}"` + (conversationContext ? ' (with context)' : ''))

  const contextBlock = conversationContext && conversationContext.trim()
    ? `PREVIOUS CONVERSATION CONTEXT (user may be answering a follow-up or continuing):\n${conversationContext.trim()}\n\nCURRENT USER MESSAGE: `
    : 'USER REQUEST: '

  const prompt = `You are an AI browser automation agent. Break down this user request into step-by-step browser actions.
${contextBlock}"${message}"

Respond with ONLY this JSON structure:
{
  "goal": "concise summary of end goal",
  "steps": [
    {"step": 1, "description": "Navigate to example.com"},
    {"step": 2, "description": "Type 'query' into the search input"},
    {"step": 3, "description": "Click the submit button"}
  ]
}

Rules:
- Each step = ONE atomic browser action (navigate, click, type)
- Be specific: say exactly what to click, what to type, where to go
- First step should be navigation if user isn't already on the right page
- Maximum 10 steps
- If the user's message is a short follow-up (e.g. "yes", "the first one", "try that"), interpret it in light of the previous conversation context
- Respond with ONLY valid JSON`

  const text = await callGemini(prompt)
  const parsed = parseGeminiJSON(text)

  if (parsed && parsed.steps) {
    console.log(`[PLAN] ${parsed.steps.length} steps: ${parsed.goal}`)
    return { success: true, plan: parsed }
  }

  return { success: true, plan: { goal: message, steps: [{ step: 1, description: message }] } }
}

async function handleStep(data) {
  if (!ai) return { success: false, error: "Gemini API not configured" }

  const { goal, plan, stepIndex, pageContext, currentURL, actionsTakenThisStep } = data
  const currentStep = plan.steps[stepIndex]

  if (!currentStep) return { success: true, action: "done", thought: "All steps completed" }

  console.log(`[STEP ${stepIndex + 1}/${plan.steps.length}] ${currentStep.description}`)

  const elementsFormatted = formatElements(pageContext.elements)
  const alreadyDone = Array.isArray(actionsTakenThisStep) && actionsTakenThisStep.length > 0
    ? `\nACTIONS ALREADY DONE FOR THIS STEP (do not repeat these):\n${actionsTakenThisStep.map(a => `- ${a.action}${a.url ? ' to ' + a.url : ''}${a.elementId != null ? ' element ' + a.elementId : ''}${a.text ? ' "' + a.text + '"' : ''}`).join('\n')}\nIf this step is now complete, return {"action":"done","thought":"reason"}.`
    : ''

  const prompt = `You are an AI browser automation agent executing a plan.

GOAL: "${goal}"

PLAN:
${plan.steps.map(s => `  ${s.step}. ${s.description}`).join('\n')}

CURRENT STEP (${stepIndex + 1} of ${plan.steps.length}): "${currentStep.description}"
${alreadyDone}

CURRENT PAGE:
  URL: ${currentURL || 'about:blank'}
  Title: ${pageContext.title || '(untitled)'}
  Headings: ${(pageContext.headings || []).join(' | ') || '(none)'}
  Visible text excerpt: ${(pageContext.mainText || '').substring(0, 1200) || '(none)'}

INTERACTIVE ELEMENTS:
${elementsFormatted}

Pick ONE action. Use the element [id] number from the list above.

STRICT ACTION SCHEMAS (respond with exactly one):

Navigate to a URL:
{"action":"navigate","url":"https://...","thought":"reason"}

Click element by ID:
{"action":"click","elementId":<number>,"thought":"reason"}

Type into input by ID:
{"action":"type","elementId":<number>,"text":"text to type","thought":"reason"}

Step is complete:
{"action":"done","thought":"reason","result":"optional key info you found that helps answer the user"}

Rules:
- elementId MUST be a number from the [id] column above
- For type: pick the correct input element, provide exact text
- For click: pick the exact button/link element
- If the step is already fulfilled by the current page state, return done
- Do NOT suggest an action already listed in ACTIONS ALREADY DONE FOR THIS STEP
- One action per response then we will ask again; return done when this step is achieved
- If the user's request is informational (recommendations, comparisons, best-of), use "result" on done to capture the useful info you learned from the page
- Respond with ONLY the JSON object`

  const text = await callGemini(prompt)
  const parsed = parseGeminiJSON(text)

  if (parsed && parsed.action) {
    const part = parsed.action === 'navigate' ? parsed.url : parsed.action === 'type' ? `element ${parsed.elementId}, text` : parsed.elementId != null ? `element ${parsed.elementId}` : ''
    console.log(`[STEP ${stepIndex + 1}] ${parsed.action}${part ? ': ' + part : ''} | ${parsed.thought || ''}`)
    return { success: true, ...parsed }
  }

  console.error('[STEP] Parse failed:', text)
  return { success: false, action: "done", thought: "Could not parse action" }
}

async function handleSummary(data) {
  if (!ai) return { success: false, error: "Gemini API not configured" }

  const { userQuery, goal, finalURL, finalPageContext, findings, plan } = data
  const host = finalURL ? (() => { try { return new URL(finalURL).hostname } catch (e) { return finalURL } })() : ''

  const findingsText = Array.isArray(findings) && findings.length
    ? findings.map(f => `- Step ${f.step}: ${String(f.result || '').trim()}${f.url ? ` (on ${f.url})` : ''}`).join('\n')
    : '(no explicit findings recorded)'

  const planText = plan && Array.isArray(plan.steps)
    ? plan.steps.map(s => `- ${s.step}. ${s.description}`).join('\n')
    : '(plan unavailable)'

  const pageText = finalPageContext && typeof finalPageContext === 'object'
    ? `Title: ${finalPageContext.title || '(untitled)'}\nHeadings: ${(finalPageContext.headings || []).join(' | ') || '(none)'}\nVisible text excerpt: ${(finalPageContext.mainText || '').substring(0, 2000) || '(none)'}`
    : '(no page context)'

  const prompt = `You are a helpful browsing assistant. The user asked a question and the agent browsed the web.

Your job: answer the user's request with the best possible final result.
Do NOT narrate what you clicked or typed unless it is directly relevant to the answer.

USER REQUEST:
"${userQuery || goal}"

PLAN (for context):
${planText}

FINDINGS CAPTURED DURING BROWSING:
${findingsText}

CURRENT PAGE (for reference):
Host: ${host || 'unknown'}
${pageText}

Write the final answer to the user:
- Focus on the actual result (recommendations, comparison, key facts, next steps they should take)
- If the browsing context doesn't contain enough info to answer fully, say what you found and ask 1 precise follow-up question
- Plain text, no JSON`

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt
    })
    let summary = (response.text || '').trim()
    if (summary.startsWith('"') && summary.endsWith('"')) summary = summary.slice(1, -1)
    if (!summary) summary = `I couldn't generate a solid answer yet. You're on ${host || 'the page'} now. What should I focus on?`
    console.log('[SUMMARY]', summary)
    return { success: true, summary }
  } catch (error) {
    console.error('[SUMMARY] Error:', error.message)
    return { success: false, error: error.message }
  }
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected')

  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch (e) { return }

    const requestId = msg.requestId

    try {
      if (msg.type === 'plan') {
        const result = await handlePlan(msg.message, msg.conversationContext)
        ws.send(JSON.stringify({ type: 'plan_result', requestId, ...result }))
      }

      if (msg.type === 'summarize_conversation') {
        const result = await handleSummarizeConversation(msg.messages || [])
        ws.send(JSON.stringify({ type: 'summarize_conversation_result', requestId, ...result }))
      }

      if (msg.type === 'step') {
        const result = await handleStep(msg)
        ws.send(JSON.stringify({ type: 'step_result', requestId, ...result }))
      }

      if (msg.type === 'summary') {
        const result = await handleSummary(msg)
        ws.send(JSON.stringify({ type: 'summary_result', requestId, ...result }))
      }
    } catch (error) {
      console.error(`[WS] Error handling ${msg.type}:`, error.message)
      ws.send(JSON.stringify({ type: 'error', requestId, error: error.message }))
    }
  })

  ws.on('close', () => {
    console.log('[WS] Client disconnected')
  })
})

server.listen(PORT, () => {
  console.log(`Backend listening on ${PORT} (HTTP + WebSocket)`)
})
