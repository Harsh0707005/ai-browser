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
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest'

if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env file')
}
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set in .env file')
}
if (!CLAUDE_API_KEY) {
  console.error('CLAUDE_API_KEY is not set in .env file')
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

async function callClaude(prompt, opts = {}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: opts.json ? 2048 : 3072,
      messages: [{ role: 'user', content: prompt }],
      ...(opts.json ? { system: 'Respond with valid JSON only.' } : {})
    })
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : `Claude API error (${response.status})`
    throw new Error(msg)
  }

  const blocks = data && Array.isArray(data.content) ? data.content : []
  const text = blocks
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim()
  return text
}

async function callLLM(prompt, model, opts = {}) {
  if (model === 'claude') {
    if (!CLAUDE_API_KEY) return Promise.reject(new Error('Claude API not configured (set CLAUDE_API_KEY in .env)'))
    return callClaude(prompt, opts)
  }

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
Critical accuracy rule: do NOT fabricate any number, metric, detail, quote, or fact. If something is missing or uncertain in the conversation, omit it instead of guessing.

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
In the response you may use markdown. For tabular data use a fenced code block with language "table-json" containing a single JSON object with "columns" (array of header strings) and "rows" (array of arrays of cell values).
Accuracy rule for direct answers: never fabricate any number, metric, price, date, name, quote, source, or detail. If you are not sure or do not have a value, clearly say it is unavailable/unknown or omit it.

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
- Break the goal into small, concrete subactions. Avoid large vague steps; prefer short step descriptions that each accomplish one clear objective
- Ensure steps are not repetitive clones: each step should represent a distinct action/progression toward the goal
- Be specific: say exactly what to click, what to type, where to go
- Maximum 10 steps
- If the user's message is a short follow-up (e.g. "yes", "the first one", "try that"), interpret it in light of the previous conversation context
- Do not invent facts in step descriptions. If a specific detail is unknown, keep the step generic and evidence-seeking rather than asserting made-up values
- Do not assume site structure in advance (forms, submit flows, selectors, menus, layout). Different sites can be structured or unstructured
- For interactions, plan to first inspect the visible page elements/context, then decide the exact interaction pattern based on what is actually present
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
- Do not assume conventional HTML structure. A flow may use forms, or plain div/button driven UI, or custom widgets. Base actions only on elements actually present in CURRENT PAGE / INTERACTIVE ELEMENTS
- Decide interaction strategy only after inspecting current page context; if unsure, use the safest next exploratory action grounded in visible elements
- If the step is already fulfilled by the current page state, return done
- Do NOT suggest an action already listed in ACTIONS ALREADY DONE FOR THIS STEP
- One action per response then we will ask again; return done when this step is achieved
- If the user's request is informational (recommendations, comparisons, best-of, research), use "result" on done to capture the useful info you learned from the page
- When returning done for research or informational steps, include the current page URL in result so it can be cited (e.g. "Source: <current page URL>" or inline the URL where relevant). Include any other relevant URLs from the page (articles, studies, products) when they support the answer
- Never fabricate numbers, metrics, claims, names, prices, or any factual detail in "thought" or "result". Only include details visible on the current page or already provided in plan/context. If a value is not available, omit it or mark it unknown
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
- Include relevant sources: cite URLs, links, and references so the user can navigate to them. For research, comparisons, or any factual answer, add clear citations and source links (use markdown links: [description](https://url))
- List or inline any web URLs that were used so the user can open them (products, articles, docs, etc.)
- When your answer includes tabular data (comparisons, prices, lists, etc.), format that table as a JSON object with two keys: "columns" (array of column header strings) and "rows" (array of arrays, each inner array is one row of cell values). Put this JSON inside a fenced code block with language "table-json" so it renders as a proper table.
- If the browsing context doesn't contain enough info to answer fully, say what you found and ask 1 precise follow-up question
- Critical accuracy rule: do NOT fabricate any number, metric, detail, quote, source, or fact. If a detail cannot be verified from findings/page context, do not include it. Be blunt about missing information
- Plain text with optional markdown links; no JSON in the main answer except inside table-json code blocks`

  try {
    const text = await callLLM(prompt, model, { json: false })
    let summary = (text || '').trim()
    if (summary.startsWith('"') && summary.endsWith('"')) summary = summary.slice(1, -1)
    if (!summary) summary = `I couldn't generate a solid answer yet. You're on ${host || 'the page'} now. What should I focus on?`
    const closurePrompt = `Decide whether agent-controlled browser tabs should be closed after this run.

Return ONLY valid JSON:
{"closeTabs":true|false,"reason":"short reason"}

Context:
USER REQUEST:
"${userQuery || goal}"

PLAN:
${planText}

FINDINGS:
${findingsText}

CURRENT PAGE:
Host: ${host || 'unknown'}
${pageText}

FINAL ANSWER DRAFT:
${summary}

Decision policy:
- closeTabs=true only when the task is closed-loop and the user likely does not need to continue interacting on the current page
- closeTabs=false when the task appears open-loop and likely needs user continuation on-page (review/edit/confirm/submit/sign-in/payment/captcha/follow-up interaction)
- Do not rely on assumptions about site structure; decide only from the provided context
- If uncertain, choose closeTabs=false
- Never fabricate details or metrics`

    let closeTabs = false
    let closeTabsReason = 'Kept open by default for potential user continuation'
    try {
      const closureText = await callLLM(closurePrompt, model, { json: true })
      const closureParsed = parseJSON(closureText)
      if (closureParsed && typeof closureParsed.closeTabs === 'boolean') {
        closeTabs = closureParsed.closeTabs
        if (closureParsed.reason && String(closureParsed.reason).trim()) {
          closeTabsReason = String(closureParsed.reason).trim()
        }
      }
    } catch (_) {}

    console.log('[SUMMARY]', summary)
    console.log('[CLOSURE]', closeTabs ? 'close' : 'keep', '|', closeTabsReason)
    return { success: true, summary, closeTabs, closeTabsReason }
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
