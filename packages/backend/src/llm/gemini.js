import { GoogleGenAI } from '@google/genai'

let client = null

export function initGemini(apiKey) {
  if (!apiKey) return
  client = new GoogleGenAI({ apiKey })
}

export function isGeminiReady() {
  return client !== null
}

export async function callGemini(prompt, opts = {}) {
  return callGeminiChat([{ role: 'user', content: prompt }], null, opts)
}

/**
 * Multi-turn conversation call.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {string|null} systemPrompt
 * @param {{ json?: boolean, tools?: Array }} opts
 * @returns {Promise<string | { toolName: string, toolInput: object }>}
 */
export async function callGeminiChat(messages, systemPrompt, opts = {}) {
  // Map standard {role, content} to Gemini's {role, parts} format
  // Gemini uses 'model' instead of 'assistant'
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const config = {}
  if (systemPrompt) config.systemInstruction = systemPrompt

  if (opts.tools && opts.tools.length > 0) {
    // Function declarations — Gemini is forced to call one of the defined functions
    config.tools = [{
      functionDeclarations: opts.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }]
    config.toolConfig = { functionCallingConfig: { mode: 'ANY' } }
  } else if (opts.json) {
    config.responseMimeType = 'application/json'
  }

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config,
  })

  if (opts.tools) {
    // Try the SDK's helper first, fall back to raw candidate inspection
    const calls = typeof response.functionCalls === 'function'
      ? response.functionCalls()
      : response.functionCalls

    if (Array.isArray(calls) && calls.length > 0) {
      return { toolName: calls[0].name, toolInput: calls[0].args }
    }

    // Raw fallback — walk candidate parts for a functionCall part
    const parts = response.candidates?.[0]?.content?.parts || []
    const fcPart = parts.find(p => p.functionCall)
    if (fcPart) {
      return { toolName: fcPart.functionCall.name, toolInput: fcPart.functionCall.args }
    }

    throw new Error('Gemini did not return a function call')
  }

  return response.text
}
