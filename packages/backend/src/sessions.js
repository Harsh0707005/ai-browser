/**
 * In-memory agent session store.
 * Each session represents one step's execution — a live conversation thread
 * between the browser and the LLM.
 */

const sessions = new Map()

export function createSession(sessionId, data) {
  sessions.set(sessionId, {
    ...data,
    messages: [],     // conversation thread [{role, content}]
    createdAt: Date.now(),
  })
}

export function getSession(sessionId) {
  return sessions.get(sessionId)
}

export function deleteSession(sessionId) {
  sessions.delete(sessionId)
}

// Clean up sessions older than 30 minutes (safety valve for orphaned sessions)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < cutoff) {
      sessions.delete(id)
      console.log(`[SESSION] Cleaned up orphaned session ${id}`)
    }
  }
}, 5 * 60 * 1000)
