import { callLLM, callLLMChat } from '../llm/index.js'
import { parseJSON } from '../utils/parseJSON.js'
import { formatElements } from '../utils/formatElements.js'
import { createSession, getSession, deleteSession } from '../sessions.js'
import {
  isComposioReady,
  ensureToolConnection,
  executeComposioTool,
} from '../composio/index.js'

// ── Tool definitions (provider-agnostic JSON Schema) ────────────────────────
// All three providers (Claude tool_use, OpenAI function_calling, Gemini functionDeclarations)
// receive these same definitions and are forced to call exactly one per turn.
const AGENT_TOOLS = [
  {
    name: 'navigate',
    description: 'Navigate the browser tab to a URL. Use when you need to open a different page.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL including https://' },
        thought: { type: 'string', description: 'Why navigating here progresses the step goal' },
      },
      required: ['url', 'thought'],
    },
  },
  {
    name: 'click',
    description: 'Click an interactive element on the page. Use the [id] number from the INTERACTIVE ELEMENTS list.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'integer', description: 'The [id] number from the INTERACTIVE ELEMENTS list' },
        thought: { type: 'string', description: 'Why clicking this element progresses the step goal' },
      },
      required: ['elementId', 'thought'],
    },
  },
  {
    name: 'type',
    description: 'Type text into an input element. Use the [id] number from the INTERACTIVE ELEMENTS list.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'integer', description: 'The [id] number from the INTERACTIVE ELEMENTS list' },
        text: { type: 'string', description: 'The exact text to type into the element' },
        thought: { type: 'string', description: 'Why typing this text progresses the step goal' },
      },
      required: ['elementId', 'text', 'thought'],
    },
  },
  {
    name: 'step_complete',
    description: 'Declare the current step goal as fully achieved. Only call this when what is visible on the page confirms the step goal is done.',
    parameters: {
      type: 'object',
      properties: {
        finding: { type: 'string', description: 'What was accomplished or found — include specific data, values, and URLs as evidence' },
        thought: { type: 'string', description: 'Why the step goal is now complete based on what is visible on the page' },
      },
      required: ['finding', 'thought'],
    },
  },
]

// ── System prompt ────────────────────────────────────────────────────────────
// Kept brief — tool definitions communicate the available actions and their schemas.
const AGENT_SYSTEM = `You are an AI browser automation agent executing tasks inside the user's own browser.
On each turn you receive the current page state. Use the available tools to either take the next action (navigate, click, type) or declare the step complete (step_complete).
Base every decision only on what is actually visible in the current page state and interactive elements. Never fabricate facts, prices, names, or data not visible on the page.`

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildInitialMessage(session, pageContext, currentURL) {
  const { goal, plan, stepIndex, completedStepsHistory } = session
  const currentStep = plan.steps[stepIndex]

  const planStatus = plan.steps.map(s => {
    const idx = s.step - 1
    const done = completedStepsHistory.some(h => h.stepIndex === idx)
    const isCurrent = idx === stepIndex
    const icon = done ? '✓' : isCurrent ? '→' : '○'
    const label = done ? '[DONE]' : isCurrent ? '[CURRENT]' : '[PENDING]'
    return `  ${icon} Step ${s.step}: ${s.description} ${label}`
  }).join('\n')

  const completedContext = completedStepsHistory.length > 0
    ? completedStepsHistory.map(h =>
        `  Step ${h.stepIndex + 1} (${h.description}): ${h.finding || '(no finding)'}`
      ).join('\n')
    : '  None — this is the first step.'

  const elementsFormatted = formatElements(pageContext?.elements)

  return `OVERALL GOAL: "${goal}"

PLAN STATUS:
${planStatus}

COMPLETED STEPS CONTEXT:
${completedContext}

CURRENT STEP GOAL (Step ${stepIndex + 1}): "${currentStep.description}"

CURRENT PAGE STATE:
  URL: ${currentURL || 'about:blank'}
  Title: ${pageContext?.title || '(untitled)'}
  Headings: ${(pageContext?.headings || []).join(' | ') || '(none)'}
  Page content: ${(pageContext?.mainText || '').substring(0, 1500) || '(none)'}

INTERACTIVE ELEMENTS:
${elementsFormatted || '  (none)'}

Examine the page and use the appropriate tool to progress toward the step goal, or declare it complete if already achieved.`
}

function buildObservationMessage(lastAction, lastActionSuccess, lastActionError, pageContext, currentURL) {
  const actionDesc = lastAction.action === 'navigate'
    ? `navigate → ${lastAction.url}`
    : lastAction.action === 'type'
      ? `type "${lastAction.text}" → element [${lastAction.elementId}]`
      : `${lastAction.action} → element [${lastAction.elementId}]`

  const outcome = lastActionSuccess ? '[success]' : `[failed: ${lastActionError || 'unknown'}]`
  const failureNote = !lastActionSuccess
    ? '\nThe last action failed — try a different approach, do not retry the same way.'
    : ''

  const elementsFormatted = formatElements(pageContext?.elements)

  return `Action executed: ${actionDesc} ${outcome}${failureNote}

CURRENT PAGE STATE:
  URL: ${currentURL || 'about:blank'}
  Title: ${pageContext?.title || '(untitled)'}
  Headings: ${(pageContext?.headings || []).join(' | ') || '(none)'}
  Page content: ${(pageContext?.mainText || '').substring(0, 1500) || '(none)'}

INTERACTIVE ELEMENTS:
${elementsFormatted || '  (none)'}

Has the current step goal been achieved based on what is visible? If yes → step_complete. If no → next action.`
}

// Stores a human-readable summary of the tool call back into history.
// This keeps conversation history as plain text (compatible with all providers
// across turns) while still leveraging tool calling for structured output on each turn.
function toolCallToHistoryEntry({ toolName, toolInput }) {
  if (toolName === 'navigate') {
    return `[navigate → ${toolInput.url}] — ${toolInput.thought}`
  }
  if (toolName === 'click') {
    return `[click → element ${toolInput.elementId}] — ${toolInput.thought}`
  }
  if (toolName === 'type') {
    return `[type "${toolInput.text}" → element ${toolInput.elementId}] — ${toolInput.thought}`
  }
  if (toolName === 'step_complete') {
    return `[step_complete] Finding: ${toolInput.finding} — ${toolInput.thought}`
  }
  return `[${toolName}]`
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function handleAgentStart(data) {
  const {
    sessionId, goal, plan, stepIndex = 0, completedStepsHistory = [],
    pageContext, currentURL, model = 'gemini',
  } = data

  createSession(sessionId, { goal, plan, stepIndex, completedStepsHistory, model })

  const session = getSession(sessionId)
  const initialMessage = buildInitialMessage(session, pageContext, currentURL)
  session.messages.push({ role: 'user', content: initialMessage })

  let toolCall
  try {
    toolCall = await callLLMChat(session.messages, AGENT_SYSTEM, model, { tools: AGENT_TOOLS })
  } catch (err) {
    deleteSession(sessionId)
    return { success: false, error: err.message }
  }

  // Store a text summary as the assistant turn (keeps history compatible across providers)
  session.messages.push({ role: 'assistant', content: toolCallToHistoryEntry(toolCall) })

  console.log(`[AGENT ${sessionId}] start | step ${stepIndex + 1}/${plan.steps.length} | ${toolCall.toolName}`)
  return buildResponse(toolCall, sessionId)
}

export async function handleAgentObserve(data) {
  const { sessionId, lastAction, lastActionSuccess, lastActionError, pageContext, currentURL } = data

  const session = getSession(sessionId)
  if (!session) return { success: false, error: `Session ${sessionId} not found` }

  const observationMessage = buildObservationMessage(
    lastAction, lastActionSuccess, lastActionError, pageContext, currentURL
  )
  session.messages.push({ role: 'user', content: observationMessage })

  let toolCall
  try {
    toolCall = await callLLMChat(session.messages, AGENT_SYSTEM, session.model, { tools: AGENT_TOOLS })
  } catch (err) {
    return { success: false, error: err.message }
  }

  session.messages.push({ role: 'assistant', content: toolCallToHistoryEntry(toolCall) })

  const actionDesc = lastAction
    ? `${lastAction.action}${lastAction.url ? ' ' + lastAction.url : lastAction.elementId != null ? ' elem ' + lastAction.elementId : ''}`
    : ''
  console.log(`[AGENT ${sessionId}] observe | after ${actionDesc} | → ${toolCall.toolName}`)

  return buildResponse(toolCall, sessionId)
}

// ── Response normalization ───────────────────────────────────────────────────

function buildResponse({ toolName, toolInput }, sessionId) {
  if (toolName === 'step_complete') {
    deleteSession(sessionId)
    return {
      success: true,
      agentResponse: {
        type: 'step_complete',
        finding: toolInput.finding || '',
        thought: toolInput.thought || '',
      },
    }
  }

  // navigate, click, or type
  if (['navigate', 'click', 'type'].includes(toolName)) {
    return {
      success: true,
      agentResponse: {
        type: 'action',
        action: toolName,
        url: toolInput.url,
        elementId: toolInput.elementId,
        text: toolInput.text,
        thought: toolInput.thought,
      },
    }
  }

  return { success: false, error: `Unknown tool: ${toolName}` }
}

// ── Tool step handler ────────────────────────────────────────────────────────
// Called when a plan step has toolSlug — executes a Composio tool using
// context collected from completed prior steps, bypassing the browser entirely.

export async function handleAgentToolStep(data) {
  const { goal, plan, stepIndex, completedStepsHistory = [], model = 'gemini' } = data
  const currentStep = plan.steps[stepIndex]
  const toolSlug = currentStep?.toolSlug

  if (!toolSlug) return { success: false, error: 'No toolSlug on step' }
  if (!isComposioReady()) return { success: false, error: 'Composio not configured' }

  console.log(`[TOOL STEP ${stepIndex + 1}] ${toolSlug} | "${currentStep.description}"`)

  // Build context from completed steps' findings
  const findingsContext = completedStepsHistory.length > 0
    ? completedStepsHistory.map(h =>
        `Step ${h.stepIndex + 1} (${h.description}): ${h.finding || '(none)'}`
      ).join('\n')
    : '(no prior findings)'

  // ── Step 1: Ensure the service is connected ────────────────────────────────
  let conn
  try {
    conn = await Promise.race([
      ensureToolConnection(toolSlug, 'default'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Connection check timed out')), 10000)),
    ])
  } catch (e) {
    return { success: false, error: e.message }
  }

  if (!conn.connected) {
    if (conn.redirectUrl) {
      return { success: true, needsConnection: true, serviceLabel: conn.serviceLabel, redirectUrl: conn.redirectUrl }
    }
    return { success: false, error: `${conn.serviceLabel ?? 'Service'} is not connected` }
  }

  // ── Step 2: Ask LLM to construct tool arguments from context ──────────────
  const schemaBlock = currentStep.toolParameters
    ? `\nTOOL PARAMETER SCHEMA — you MUST include all required fields exactly as named:\n${JSON.stringify(currentStep.toolParameters, null, 2)}\n`
    : ''

  const slug = toolSlug.toUpperCase()
  const toneInstruction = slug.includes('SEND_EMAIL') || slug.includes('CREATE_EMAIL_DRAFT') || slug.includes('REPLY_EMAIL')
    ? '\nTONE FOR EMAIL: Write the email body as if the user is writing it themselves — natural, warm, and conversational. Avoid formal AI-summary language or bullet-point summaries. Write in flowing sentences like a real person would.\n'
    : slug.includes('WHATSAPP')
      ? '\nTONE FOR MESSAGE: Write the message casually and informally — like a real person texting a friend. Short sentences, natural language, no formal structure.\n'
      : ''

  const argsPrompt = `You are constructing the arguments object for the Composio tool "${toolSlug}".

STEP: "${currentStep.description}"
${currentStep.toolDescription ? `TOOL DESCRIPTION: ${currentStep.toolDescription}\n` : ''}${schemaBlock}
OVERALL GOAL: "${goal}"

CONTEXT FROM COMPLETED STEPS (use this to fill content fields like email body, message, document content, etc.):
${findingsContext}
${toneInstruction}
Rules:
- Include ALL required fields from the schema above with their exact names
- Use the context above to populate content fields (body, message, subject, etc.)
- Do not invent data not present in the context or goal

Respond with ONLY a valid JSON object of arguments — no explanation.`

  let toolArgs
  try {
    const argsText = await callLLM(argsPrompt, model, { json: true })
    toolArgs = parseJSON(argsText)
    if (!toolArgs || typeof toolArgs !== 'object') throw new Error('Could not parse tool arguments')
  } catch (e) {
    return { success: false, error: `Failed to construct tool arguments: ${e.message}` }
  }

  // ── Step 3: Execute the Composio tool ─────────────────────────────────────
  let toolResult
  try {
    toolResult = await Promise.race([
      executeComposioTool(toolSlug, toolArgs, 'default'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Tool execution timed out')), 20000)),
    ])
    console.log(`[TOOL STEP ${stepIndex + 1}] ${toolSlug} executed | keys: ${toolResult ? Object.keys(toolResult).join(',') : 'null'}`)
  } catch (e) {
    return { success: false, error: `Tool execution failed: ${e.message}` }
  }

  // ── Step 4: Summarize the result ──────────────────────────────────────────
  const interpretPrompt = `The step "${currentStep.description}" just ran the tool "${toolSlug}".

Result:
${JSON.stringify(toolResult, null, 2).substring(0, 1500)}

Write a single concise sentence summarizing what was accomplished. Plain text only.`

  let finding = `Executed ${toolSlug} successfully`
  try {
    finding = ((await callLLM(interpretPrompt, model, { json: false })) || finding).trim()
  } catch (_) {}

  return { success: true, finding, thought: `${toolSlug} executed successfully` }
}
