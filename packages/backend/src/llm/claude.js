let apiKey = null
let model = 'claude-3-5-sonnet-latest'

export function initClaude(key, modelId) {
  if (!key) return
  apiKey = key
  if (modelId) model = modelId
}

export function isClaudeReady() {
  return apiKey !== null
}

export async function callClaude(prompt, opts = {}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.json ? 2048 : 3072,
      messages: [{ role: 'user', content: prompt }],
      ...(opts.json ? { system: 'Respond with valid JSON only.' } : {})
    })
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const msg = data?.error?.message ?? `Claude API error (${response.status})`
    throw new Error(msg)
  }

  const blocks = Array.isArray(data?.content) ? data.content : []
  return blocks
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim()
}
