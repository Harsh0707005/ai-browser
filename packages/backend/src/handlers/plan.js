import { callLLM } from '../llm/index.js'
import { parseJSON } from '../utils/parseJSON.js'
import {
  isComposioReady,
  matchServices,
  getToolsForServices,
  executeComposioTool,
  ensureToolConnection,
} from '../composio/index.js'

function toolProgressLabel(slug) {
  const s = slug.toUpperCase()
  if (s.includes('SEND_EMAIL')) return 'Sending email'
  if (s.includes('FETCH_EMAIL') || s.includes('LIST_MESSAGES') || s.includes('LIST_THREADS')) return 'Fetching emails'
  if (s.includes('CREATE_EMAIL_DRAFT')) return 'Creating email draft'
  if (s.includes('LIST_FILES') || s.includes('FIND_FILE')) return 'Fetching Drive files'
  if (s.includes('UPLOAD_FILE')) return 'Uploading file to Drive'
  if (s.includes('CREATE_FILE') || s.includes('CREATE_FOLDER')) return 'Creating Drive file'
  if (s.includes('DOWNLOAD_FILE')) return 'Downloading file'
  if (s.includes('CREATE_EVENT') || s.includes('QUICK_ADD')) return 'Creating calendar event'
  if (s.includes('EVENTS_LIST') || s.includes('FIND_EVENT') || s.includes('GET_CURRENT_DATE')) return 'Fetching calendar events'
  if (s.includes('UPDATE_EVENT') || s.includes('PATCH_EVENT')) return 'Updating calendar event'
  if (s.includes('DELETE_EVENT')) return 'Deleting calendar event'
  if (s.includes('CREATE_MEET') || s.includes('CREATE_SPACE')) return 'Creating Meet link'
  if (s.includes('GET_MEET') || s.includes('LIST_CONFERENCE')) return 'Fetching meeting info'
  if (s.includes('CREATE_DOCUMENT') || s.includes('CREATE_DOCUMENT_MARKDOWN')) return 'Creating document'
  if (s.includes('GET_DOCUMENT') || s.includes('SEARCH_DOCUMENTS')) return 'Fetching document'
  if (s.includes('UPDATE_DOCUMENT') || s.includes('INSERT_TEXT') || s.includes('REPLACE_ALL_TEXT')) return 'Updating document'
  if (s.includes('CREATE_GOOGLE_SHEET') || s.includes('SHEET_FROM_JSON')) return 'Creating spreadsheet'
  if (s.includes('VALUES_GET') || s.includes('SEARCH_SPREADSHEETS')) return 'Reading spreadsheet'
  if (s.includes('VALUES_UPDATE') || s.includes('VALUES_APPEND') || s.includes('UPSERT_ROWS')) return 'Updating spreadsheet'
  return 'Running tool'
}

export async function handlePlan(message, conversationContext, model = 'gemini', clientDateTime, sendProgress = () => {}, whatsappConnected = false) {
  console.log(`[PLAN] "${message}" (model: ${model})` + (conversationContext ? ' (with context)' : ''))

  // ── Keyword pre-routing ──────────────────────────────────────────────────
  // Match services by keyword scan — avoids loading 100+ tools on every request.
  // Only services whose keywords appear in the message are fetched.
  let externalTools = []
  if (isComposioReady()) {
    const matched = matchServices(message)
    if (matched.length) {
      try {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tool fetch timed out after 8s')), 8000)
        )
        externalTools = await Promise.race([
          getToolsForServices(matched.map(s => s.key)),
          timeout,
        ])
        console.log(`[PLAN] ${externalTools.length} tools from: ${matched.map(s => s.label).join(', ')}`)
      } catch (e) {
        console.error('[PLAN] Tool fetch failed:', e.message)
      }
    }
  }

  // ── Build tools block for prompt ─────────────────────────────────────────
  // WhatsApp is always exposed as a built-in tool so the LLM treats it like
  // any other tool and prefers it over browsing — no special-casing needed.
  const WA_BUILTIN_TOOL = {
    slug: 'WHATSAPP_SEND_MESSAGE',
    name: 'Send WhatsApp Message',
    description: 'Send a WhatsApp message to a contact. Always use this tool for any WhatsApp send request — never browse WhatsApp Web.',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Recipient phone number with country code, digits only.' },
        message: { type: 'string', description: 'The message text to send.' },
      },
      required: ['phone', 'message'],
    },
  }

  const serviceGroups = { WhatsApp: [WA_BUILTIN_TOOL] }
  for (const t of externalTools) {
    if (!serviceGroups[t.serviceLabel]) serviceGroups[t.serviceLabel] = []
    serviceGroups[t.serviceLabel].push({
      slug: t.slug,
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })
  }

  const toolsBlock = `AVAILABLE EXTERNAL TOOLS:
${Object.entries(serviceGroups)
  .map(([label, tools]) => `## ${label}\n${JSON.stringify(tools, null, 2)}`)
  .join('\n\n')}

Call a tool by returning: {"type": "tool_call", "tool": "<exact slug>", "arguments": {<valid JSON matching that tool's parameters>}}
Rules: slug must be exact. Use minimal safe arguments. Don't guess IDs or phone numbers.

`

  const activeServiceLabels = Object.keys(serviceGroups)
  const toolUseInstruction = activeServiceLabels.length
    ? `MANDATORY: USE EXTERNAL TOOLS for any request involving ${activeServiceLabels.join(', ')}.
- You MUST call the matching tool — do NOT browse the web for these services.
- "create a sheet", "make a doc", "start a meeting", "send a whatsapp message" etc. → call the tool, never navigate to a URL.
- Pick the single best matching tool slug from AVAILABLE EXTERNAL TOOLS.`
    : ''

  const contextBlock = conversationContext && conversationContext.trim()
    ? `PREVIOUS CONVERSATION CONTEXT:\n${conversationContext.trim()}\n\nCURRENT USER MESSAGE: `
    : 'USER REQUEST: '

  const dateBlock = clientDateTime
    ? `CURRENT DATE/TIME: ${clientDateTime}\nWhen the user uses relative time references (e.g. "in 1 hour", "tomorrow", "next week", "this evening", "after 30 minutes"), resolve them to exact dates/times based on CURRENT DATE/TIME above and use those exact values in tool arguments.\n`
    : ''

  const prompt = `You are an AI browser assistant. Decide: call a tool, answer directly, or browse the web.
${dateBlock}
${toolsBlock}
${toolUseInstruction}

${contextBlock}"${message}"

ANSWER DIRECTLY when:
- Greetings, casual conversation, chitchat
- User provides text to summarize, explain, or analyze
- General knowledge you can confidently answer
- Follow-ups that don't need new browsing
{"type": "direct", "response": "your answer"}
You may use markdown. For tables use a fenced code block with language "table-json" containing {"columns":[...],"rows":[[...]]}.
Accuracy rule: never fabricate numbers, prices, names, quotes, or details you don't know.

BROWSE only when no tool covers the request and live web data is needed.
NEVER browse for any service listed in AVAILABLE EXTERNAL TOOLS.
{
  "type": "plan",
  "goal": "concise summary",
  "execution": {"startFromCurrentTab": false},
  "steps": [
    {"step": 1, "group": 1, "description": "Navigate to X and do Y"}
  ]
}
Plan rules: same group = parallel execution; different group = sequential. Max 10 steps. Be specific about actions.
Set startFromCurrentTab=true only when continuing from current page/prior workflow.
Do not assume site structure — plan to inspect first, then act.

Respond with ONLY valid JSON.`

  let text
  try {
    const llmTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LLM call timed out after 20s')), 20000)
    )
    text = await Promise.race([callLLM(prompt, model, { json: true }), llmTimeout])
  } catch (err) {
    return { success: false, error: err.message }
  }

  const parsed = parseJSON(text)

  // ── Tool call loop (supports chained multi-step tool calls) ─────────────
  if (parsed?.type === 'tool_call' && parsed.tool) {
    // Built-in WhatsApp tool — intercept before Composio
    if (parsed.tool === 'WHATSAPP_SEND_MESSAGE') {
      const { phone, name, message: waMsg } = parsed.arguments || {}
      if (!waMsg) return { success: false, error: 'No message text provided for WhatsApp' }
      console.log(`[PLAN] WhatsApp send via tool: to=${phone || name}, msg=${waMsg.substring(0, 60)}`)
      return { success: true, whatsappSend: { phone: phone || null, name: name || null, message: waMsg } }
    }

    if (!isComposioReady()) {
      return { success: false, error: 'Tool calling is not available right now' }
    }

    const MAX_TOOL_CALLS = 6
    const toolHistory = []
    let current = parsed

    while (current?.type === 'tool_call' && current.tool && toolHistory.length < MAX_TOOL_CALLS) {
      // Also intercept WhatsApp if it appears mid-chain
      if (current.tool === 'WHATSAPP_SEND_MESSAGE') {
        const { phone, name, message: waMsg } = current.arguments || {}
        if (waMsg) return { success: true, whatsappSend: { phone: phone || null, name: name || null, message: waMsg } }
        break
      }
      sendProgress(toolProgressLabel(current.tool) + '...')
      let toolResult
      try {
        const connTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection check timed out after 10s')), 10000)
        )
        const conn = await Promise.race([ensureToolConnection(current.tool, 'default'), connTimeout])
        if (!conn.connected) {
          if (conn.redirectUrl) {
            console.log(`[PLAN] Prompted user to connect ${conn.serviceLabel}`)
            return { success: true, needsConnection: true, serviceLabel: conn.serviceLabel, redirectUrl: conn.redirectUrl }
          }
          return { success: false, error: `${conn.serviceLabel ?? 'Service'} is not connected` }
        }

        const execTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tool execution timed out after 15s')), 15000)
        )
        toolResult = await Promise.race([
          executeComposioTool(current.tool, current.arguments || {}, 'default'),
          execTimeout,
        ])
        console.log(`[PLAN] Tool ${toolHistory.length + 1}: ${current.tool} | keys:`, toolResult ? Object.keys(toolResult).join(',') : 'null')
        toolHistory.push({ slug: current.tool, result: toolResult })
      } catch (e) {
        console.error('[PLAN] Tool execution failed:', e.message)
        const msgLower = String(e.message || '').toLowerCase()
        if (
          msgLower.includes('no connected account found') ||
          msgLower.includes('connectedaccountnotfound') ||
          msgLower.includes('no active connection exists for toolkit')
        ) {
          try {
            const conn = await ensureToolConnection(current.tool, 'default', { force: true })
            if (!conn.connected && conn.redirectUrl) {
              return { success: true, needsConnection: true, serviceLabel: conn.serviceLabel, redirectUrl: conn.redirectUrl }
            }
          } catch (_) {}
        }
        try {
          const errMsg = (await callLLM(
            `The user asked: "${message}"\n\nThe tool "${current.tool}" failed with this error:\n${e.message}\n\nWrite a short, friendly explanation of what went wrong and what the user can try instead. Plain text, 1-3 sentences.`,
            model,
            { json: false }
          )).trim()
          return { success: true, direct: true, response: errMsg }
        } catch (_) {
          return { success: false, error: e.message }
        }
      }

      // Ask LLM: are all tasks done, or is another tool call needed?
      const historyBlock = toolHistory.map((h, i) =>
        `Step ${i + 1}: Called tool "${h.slug}" → ${JSON.stringify(h.result, null, 2)}`
      ).join('\n\n')

      const continuePrompt = `You are an AI assistant completing a multi-step task using external tools.
${dateBlock}
${toolsBlock}
ORIGINAL REQUEST: "${message}"

COMPLETED TOOL CALLS:
${historyBlock}

Review the original request. Decide what to do next:
- If ALL tasks from the original request are now complete, provide a final comprehensive answer.
- If another tool call is still needed to fulfill the original request, call it now.
- Do NOT call a tool that already succeeded above.

If all tasks are complete:
{"type": "direct", "response": "comprehensive markdown answer covering all results — never fabricate details not present in the results above"}

If another tool call is needed:
{"type": "tool_call", "tool": "<exact slug>", "arguments": {<valid JSON>}}

Respond with ONLY valid JSON.`

      let nextText
      try {
        const llmTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('LLM call timed out after 20s')), 20000)
        )
        nextText = await Promise.race([callLLM(continuePrompt, model, { json: true }), llmTimeout])
        current = parseJSON(nextText)
      } catch (_) {
        current = null
        break
      }
    }

    // LLM provided a direct answer after completing all tool calls
    if (current?.type === 'direct' && current.response) {
      console.log(`[PLAN] Multi-tool complete (${toolHistory.length} calls): ${current.response.substring(0, 80)}...`)
      return { success: true, direct: true, response: current.response }
    }

    // Fallback: interpret all accumulated tool results into a natural answer
    const allResults = toolHistory
      .map((h, i) => `Tool ${i + 1} (${h.slug}):\n${JSON.stringify(h.result, null, 2)}`)
      .join('\n\n')

    const interpretPrompt = `The user asked: "${message}"

You called ${toolHistory.length} tool(s) and got these results:
${allResults}

Write a clear, natural answer based only on this data.
- Summarize meaningfully (events: name/time/date; emails: subject/sender; docs: title; etc.)
- Use markdown for readability.
- Do NOT show raw JSON. Do NOT fabricate anything not in the results.`

    let naturalAnswer
    try {
      naturalAnswer = (await callLLM(interpretPrompt, model, { json: false })).trim()
    } catch (_) {
      naturalAnswer = `\`\`\`json\n${allResults}\n\`\`\``
    }

    return { success: true, direct: true, response: naturalAnswer }
  }

  // ── WhatsApp send ────────────────────────────────────────────────────────
  if (parsed?.type === 'whatsapp_send' && parsed.phone && parsed.message) {
    console.log(`[PLAN] WhatsApp send to ${parsed.phone}: ${parsed.message.substring(0, 60)}`)
    return { success: true, whatsappSend: { phone: parsed.phone, message: parsed.message } }
  }

  // ── Direct answer ────────────────────────────────────────────────────────
  if (parsed?.type === 'direct' && parsed.response) {
    console.log(`[PLAN] Direct: ${parsed.response.substring(0, 80)}...`)
    return { success: true, direct: true, response: parsed.response }
  }

  // ── Browsing plan ────────────────────────────────────────────────────────
  if (parsed?.steps || (parsed?.type === 'plan' && parsed.steps)) {
    console.log(`[PLAN] ${parsed.steps.length} steps: ${parsed.goal}`)
    return { success: true, plan: parsed }
  }

  return { success: true, plan: { goal: message, steps: [{ step: 1, group: 1, description: message }] } }
}
