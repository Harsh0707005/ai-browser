import { callGemini, callGeminiChat, isGeminiReady } from './gemini.js'
import { callOpenAI, callOpenAIChat, isOpenAIReady } from './openai.js'
import { callClaude, callClaudeChat, isClaudeReady } from './claude.js'

export { initGemini } from './gemini.js'
export { initOpenAI } from './openai.js'
export { initClaude } from './claude.js'

/** Single-turn prompt call */
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

/**
 * Multi-turn conversation call.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {string} systemPrompt
 * @param {'gemini'|'gpt'|'claude'} model
 * @param {{ json?: boolean }} opts
 */
export async function callLLMChat(messages, systemPrompt, model, opts = {}) {
  switch (model) {
    case 'claude':
      if (!isClaudeReady()) throw new Error('Claude API not configured (set CLAUDE_API_KEY in .env)')
      return callClaudeChat(messages, systemPrompt, opts)
    case 'gpt':
      if (!isOpenAIReady()) throw new Error('OpenAI API not configured (set OPENAI_API_KEY in .env)')
      return callOpenAIChat(messages, systemPrompt, opts)
    case 'gemini':
    default:
      if (!isGeminiReady()) throw new Error('Gemini API not configured (set GEMINI_API_KEY in .env)')
      return callGeminiChat(messages, systemPrompt, opts)
  }
}
