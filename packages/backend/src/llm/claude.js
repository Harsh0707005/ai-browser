let apiKey = null
let model = 'claude-haiku-4-5'

export function initClaude(key, modelId) {
  if (!key) return
  apiKey = key
  if (modelId) model = modelId
}

export function isClaudeReady() {
  return apiKey !== null
}

export async function callClaude(prompt, opts = {}) {
  const system = opts.json
    ? 'You are an AI browser automation assistant running inside the user\'s own desktop browser app. You execute web browsing tasks on behalf of the user in their browser. Always respond with valid JSON only.'
    : 'You are an AI browser automation assistant running inside the user\'s own desktop browser app. You execute web browsing tasks on behalf of the user in their browser.'
  return callClaudeChat([{ role: 'user', content: prompt }], system, opts)
}

/**
 * Multi-turn conversation call.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {string} systemPrompt
 * @param {{ json?: boolean, tools?: Array }} opts
 * @returns {Promise<string | { toolName: string, toolInput: object }>}
 */
export async function callClaudeChat(messages, systemPrompt, opts = {}) {
  const body = {
    model,
    messages,
    system: systemPrompt || 'You are an AI browser automation assistant.',
  }

  if (opts.tools && opts.tools.length > 0) {
    // Tool use — Claude is forced to call one of the defined tools
    body.tools = opts.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }))
    body.tool_choice = { type: 'any' }
    body.max_tokens = 1024
  } else {
    body.max_tokens = opts.json ? 2048 : 3072
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const msg = data?.error?.message ?? `Claude API error (${response.status})`
    throw new Error(msg)
  }

  if (opts.tools) {
    const toolBlock = (data?.content || []).find(b => b.type === 'tool_use')
    if (!toolBlock) throw new Error('Claude did not return a tool call')
    return { toolName: toolBlock.name, toolInput: toolBlock.input }
  }

  const blocks = Array.isArray(data?.content) ? data.content : []
  return blocks
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim()
}
