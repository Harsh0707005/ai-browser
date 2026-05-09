import OpenAI from 'openai'

let client = null

export function initOpenAI(apiKey) {
  if (!apiKey) return
  client = new OpenAI({ apiKey })
}

export function isOpenAIReady() {
  return client !== null
}

const OPENAI_SYSTEM = 'You are an AI browser automation assistant running inside the user\'s own desktop browser app. You execute web browsing tasks on behalf of the user in their browser.'

export async function callOpenAI(prompt, opts = {}) {
  return callOpenAIChat([{ role: 'user', content: prompt }], OPENAI_SYSTEM, opts)
}

/**
 * Multi-turn conversation call.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {string} systemPrompt
 * @param {{ json?: boolean, tools?: Array }} opts
 * @returns {Promise<string | { toolName: string, toolInput: object }>}
 */
export async function callOpenAIChat(messages, systemPrompt, opts = {}) {
  const params = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt || OPENAI_SYSTEM },
      ...messages,
    ],
  }

  if (opts.tools && opts.tools.length > 0) {
    // Function calling — OpenAI is forced to call one of the defined functions
    params.tools = opts.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
    params.tool_choice = 'required'
  } else if (opts.json) {
    params.response_format = { type: 'json_object' }
  }

  const response = await client.chat.completions.create(params)

  if (opts.tools) {
    const toolCall = response.choices?.[0]?.message?.tool_calls?.[0]
    if (!toolCall) throw new Error('OpenAI did not return a tool call')
    return {
      toolName: toolCall.function.name,
      toolInput: JSON.parse(toolCall.function.arguments),
    }
  }

  return response.choices?.[0]?.message?.content || ''
}
