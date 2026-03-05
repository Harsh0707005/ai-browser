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
  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    generationConfig: opts.json ? { responseMimeType: 'application/json' } : undefined
  })
  return response.text
}
