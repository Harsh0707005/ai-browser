import OpenAI from 'openai'

let client = null

export function initOpenAI(apiKey) {
  if (!apiKey) return
  client = new OpenAI({ apiKey })
}

export function isOpenAIReady() {
  return client !== null
}

export async function callOpenAI(prompt, opts = {}) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an AI browser automation assistant running inside the user\'s own desktop browser app. You execute web browsing tasks on behalf of the user in their browser.' },
      { role: 'user', content: prompt }
    ],
    response_format: opts.json ? { type: 'json_object' } : undefined
  })
  return response.choices?.[0]?.message?.content || ''
}
