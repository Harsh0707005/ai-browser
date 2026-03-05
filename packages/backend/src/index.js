import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

import { initGemini, initOpenAI, initClaude } from './llm/index.js'
import { handlePlan } from './handlers/plan.js'
import { handleStep } from './handlers/step.js'
import { handleSummary } from './handlers/summary.js'
import { handleSummarizeConversation } from './handlers/summarizeConversation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

// Init LLM providers
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY
const CLAUDE_MODEL = process.env.CLAUDE_MODEL

if (!GEMINI_API_KEY) console.error('GEMINI_API_KEY is not set in .env file')
if (!OPENAI_API_KEY) console.error('OPENAI_API_KEY is not set in .env file')
if (!CLAUDE_API_KEY) console.error('CLAUDE_API_KEY is not set in .env file')

initGemini(GEMINI_API_KEY)
initOpenAI(OPENAI_API_KEY)
initClaude(CLAUDE_API_KEY, CLAUDE_MODEL)

// Server setup
const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })
const PORT = process.env.PORT ?? 3001

app.use(express.json())
app.get('/health', (req, res) => res.send({ message: 'healthy' }))

// WebSocket router
wss.on('connection', (ws) => {
  console.log('[WS] Client connected')

  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch (e) { return }

    const requestId = msg.requestId

    try {
      if (msg.type === 'plan') {
        const result = await handlePlan(msg.message, msg.conversationContext, msg.model || 'gemini')
        ws.send(JSON.stringify({ type: 'plan_result', requestId, ...result }))
      }

      if (msg.type === 'summarize_conversation') {
        const result = await handleSummarizeConversation(msg.messages || [], msg.model || 'gemini')
        ws.send(JSON.stringify({ type: 'summarize_conversation_result', requestId, ...result }))
      }

      if (msg.type === 'step') {
        const result = await handleStep(msg)
        ws.send(JSON.stringify({ type: 'step_result', requestId, ...result }))
      }

      if (msg.type === 'summary') {
        const result = await handleSummary(msg)
        ws.send(JSON.stringify({ type: 'summary_result', requestId, ...result }))
      }
    } catch (error) {
      console.error(`[WS] Error handling ${msg.type}:`, error.message)
      ws.send(JSON.stringify({ type: 'error', requestId, error: error.message }))
    }
  })

  ws.on('close', () => {
    console.log('[WS] Client disconnected')
  })
})

server.listen(PORT, () => {
  console.log(`Backend listening on ${PORT} (HTTP + WebSocket)`)
})
