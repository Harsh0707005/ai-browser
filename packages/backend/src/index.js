import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import OpenAI from 'openai';

dotenv.config()

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

const PORT = process.env.PORT ?? 3001
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env file')
}
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set in .env file')
}

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null

app.use(express.json())
app.get("/health", (req, res) => { return res.send({ message: "healthy" }) })

function parseJSON(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch (e) {}
  const match = text.match(/\{[\s\S]*\}/)
  if (match) { try { return JSON.parse(match[0]) } catch (e) {} }
  return null
}

async function callGemini(prompt, opts = {}) {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    generationConfig: opts.json ? { responseMimeType: 'application/json' } : undefined
  })
  return response.text
}

async function callOpenAI(prompt, opts = {}) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: opts.json ? { type: 'json_object' } : undefined
  })
  const text = response.choices?.[0]?.message?.content
  return text || ''
}

async function callLLM(prompt, model, opts = {}) {
  const useGPT = model === 'gpt'
  if (useGPT) {
    if (!openai) return Promise.reject(new Error('OpenAI API not configured (set OPENAI_API_KEY in .env)'))
    return callOpenAI(prompt, opts)
  }
  if (!ai) return Promise.reject(new Error('Gemini API not configured (set GEMINI_API_KEY in .env)'))
  return callGemini(prompt, opts)
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

async function handleSummarizeConversation(messages, model = 'gemini') {
  if (!Array.isArray(messages) || messages.length === 0) return { success: true, summary: '' }

  const transcript = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').trim()}`).join('\n')
  const prompt = `Summarize this browser-assistant conversation in 2-4 short sentences. Keep: what the user wanted to do, what was done, any follow-up question the assistant asked, and where things were left off. Plain text only, no bullets.

Conversation:
${transcript}`

  try {
    const text = await callLLM(prompt, model, { json: false })
    const summary = (text || '').trim()
    console.log('[SUMMARIZE]', summary ? summary.substring(0, 80) + '...' : '(empty)')
    return { success: true, summary }
  } catch (error) {
    console.error('[SUMMARIZE] Error:', error.message)
    return { success: false, error: error.message }
  }
}

async function handlePlan(message, conversationContext, model = 'gemini') {
  console.log(`[PLAN] "${message}" (model: ${model})` + (conversationContext ? ' (with context)' : ''))

  const contextBlock = conversationContext && conversationContext.trim()
    ? `PREVIOUS CONVERSATION CONTEXT (user may be answering a follow-up or continuing):\n${conversationContext.trim()}\n\nCURRENT USER MESSAGE: `
    : 'USER REQUEST: '

  const prompt = `You are an AI browser assistant. First decide: does this request NEED web browsing, or can you answer it directly?
${contextBlock}"${message}"

ANSWER DIRECTLY (no browsing) when:
- Greetings, casual conversation, or chitchat
- The user provides text and asks you to summarize, explain, rewrite, or analyze it
- General knowledge questions you can confidently answer
- Follow-ups about previous results that don't need new browsing
- Anything that does NOT require visiting a website, searching the web, or interacting with a page

USE BROWSING when:
- The user wants to visit, search, or look something up on the web
- The request needs live/current information from websites
- The user wants to interact with a specific site (click, fill forms, etc.)
- Price comparisons, product searches, or anything requiring real web data

If you can answer directly, respond with:
{"type": "direct", "response": "your helpful answer here"}

If browsing is needed, respond with:
{
  "type": "plan",
  "goal": "concise summary of end goal",
  "steps": [
    {"step": 1, "group": 1, "description": "Navigate to example.com and do X"},
    {"step": 2, "group": 1, "description": "Navigate to other.com and do Y"},
    {"step": 3, "group": 2, "description": "Compile results"}
  ]
}

Plan rules (only when type is "plan"):
- Each step has a "group" number. Steps within the same group execute in PARALLEL (each in its own browser tab simultaneously). Steps in different groups execute SEQUENTIALLY (lower group finishes before the next group starts).
- Use the same group for steps that are completely independent of each other. Use different groups when a step depends on a prior step's outcome.
- If the entire task is a linear chain of dependent actions, every step should have a unique group number.
- Each step = a self-contained browser task (may involve navigation + interactions on that page)
- Parallel steps (same group) must each be fully self-contained — include their own navigation since they run in separate tabs
- Be specific: say exactly what to click, what to type, where to go
- Maximum 10 steps
- If the user's message is a short follow-up (e.g. "yes", "the first one", "try that"), interpret it in light of the previous conversation context
- Respond with ONLY valid JSON`

  let text
  try {
    text = await callLLM(prompt, model, { json: true })
  } catch (err) {
    return { success: false, error: err.message }
  }
  const parsed = parseJSON(text)

  if (parsed && parsed.type === 'direct' && parsed.response) {
    console.log(`[PLAN] Direct answer: ${parsed.response.substring(0, 80)}...`)
    return { success: true, direct: true, response: parsed.response }
  }

  if (parsed && parsed.steps) {
    console.log(`[PLAN] ${parsed.steps.length} steps: ${parsed.goal}`)
    return { success: true, plan: parsed }
  }

  if (parsed && parsed.type === 'plan' && parsed.steps) {
    console.log(`[PLAN] ${parsed.steps.length} steps: ${parsed.goal}`)
    return { success: true, plan: parsed }
  }

  return { success: true, plan: { goal: message, steps: [{ step: 1, group: 1, description: message }] } }
}

async function handleStep(data) {
  const model = data.model || 'gemini'
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

  let text
  try {
    text = await callLLM(prompt, model, { json: true })
  } catch (err) {
    return { success: false, action: 'done', thought: err.message }
  }
  const parsed = parseJSON(text)

  if (parsed && parsed.action) {
    const part = parsed.action === 'navigate' ? parsed.url : parsed.action === 'type' ? `element ${parsed.elementId}, text` : parsed.elementId != null ? `element ${parsed.elementId}` : ''
    console.log(`[STEP ${stepIndex + 1}] ${parsed.action}${part ? ': ' + part : ''} | ${parsed.thought || ''}`)
    return { success: true, ...parsed }
  }

  console.error('[STEP] Parse failed:', text)
  return { success: false, action: "done", thought: "Could not parse action" }
}

async function handleSummary(data) {
  const model = data.model || 'gemini'
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
    const text = await callLLM(prompt, model, { json: false })
    let summary = (text || '').trim()
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
        const result = await handlePlan(msg.message, msg.conversationContext, msg.model || 'gemini')
        ws.send(JSON.stringify({ type: 'plan_result', requestId, ...result }))
      }

      if (msg.type === 'summarize_conversation') {
        const result = await handleSummarizeConversation(msg.messages || [], msg.model || 'gemini')
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
