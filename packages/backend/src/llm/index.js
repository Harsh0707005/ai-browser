import { callGemini, isGeminiReady } from './gemini.js'
import { callOpenAI, isOpenAIReady } from './openai.js'
import { callClaude, isClaudeReady } from './claude.js'

export { initGemini } from './gemini.js'
export { initOpenAI } from './openai.js'
export { initClaude } from './claude.js'

/**
 * LLM-agnostic call. Routes to the correct provider based on model string.
 * @param {string} prompt
 * @param {'gemini'|'gpt'|'claude'} model
 * @param {{ json?: boolean }} opts
 */
export async function callLLM(prompt, model, opts = {}) {
  switch (model) {
    case 'claude':
      if (!isClaudeReady()) throw new Error('Claude API not configured (set CLAUDE_API_KEY in .env)')
      return callClaude(prompt, opts)

    case 'gpt':
      if (!isOpenAIReady()) throw new Error('OpenAI API not configured (set OPENAI_API_KEY in .env)')
      return callOpenAI(prompt, opts)

    case 'gemini':
    default:
      if (!isGeminiReady()) throw new Error('Gemini API not configured (set GEMINI_API_KEY in .env)')
      return callGemini(prompt, opts)
  }
}
