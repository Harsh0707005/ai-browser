import { callLLM } from '../llm/index.js'

export async function handleSummarizeConversation(messages, model = 'gemini') {
  if (!Array.isArray(messages) || messages.length === 0) return { success: true, summary: '' }

  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').trim()}`)
    .join('\n')

  const prompt = `Summarize this browser-assistant conversation in 2-4 short sentences. Keep: what the user wanted to do, what was done, any follow-up question the assistant asked, and where things were left off. Plain text only, no bullets.
Critical accuracy rule: do NOT fabricate any number, metric, detail, quote, or fact. If something is missing or uncertain in the conversation, omit it instead of guessing.

Conversation:
${transcript}`

  try {
    const text = await callLLM(prompt, model, { json: false })
    const summary = (text || '').trim()
    console.log('[SUMMARIZE]', summary ? summary.substring(0, 80) + '...' : '(empty)')
    return { success: true, summary }
  } catch (error) {
    console.error('[SUMMARIZE] Error:', error.message)
    return { success: false, error: error.message }
  }
}
