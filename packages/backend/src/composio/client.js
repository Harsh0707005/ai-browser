import { Composio } from '@composio/core'

let client = null

export function initComposio(apiKey) {
  if (!apiKey) {
    console.warn('[COMPOSIO] COMPOSIO_API_KEY is not set in .env — Composio disabled')
    return
  }
  client = new Composio({ apiKey })
  console.log('[COMPOSIO] Client initialized')
}

export function isComposioReady() {
  return client !== null
}

/** Returns the raw Composio client. Throws if not initialized. */
export function getClient() {
  if (!client) throw new Error('Composio client is not initialized')
  return client
}
