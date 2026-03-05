import { getClient } from './client.js'
import { findServiceByToolSlug } from './services.js'

/**
 * Ensures the user has an active OAuth connection for the service that owns
 * the given tool slug.
 *
 * Two-path strategy:
 *  1. authConfigId set in .env  → fast check by exact auth config, initiate if missing.
 *  2. authConfigId NOT set      → list all active connections and check by toolkit slug;
 *                                 look up an auth config for the toolkit to initiate if missing.
 *
 * Pass options.force = true to skip the connection check and always initiate OAuth.
 * This is used when a tool call already failed with "No connected account" despite
 * the check returning connected (e.g. cross-service Google OAuth false positive).
 *
 * Returns:
 *   { connected: true }
 *   { connected: false, redirectUrl: string|null, serviceLabel: string }
 */
export async function ensureToolConnection(toolSlug, userId = 'default', options = {}) {
  const forceInitiate = options.force === true
  const client = getClient()

  const service = findServiceByToolSlug(toolSlug)
  if (!service) return { connected: true } // unknown service — let execute() handle it

  const authConfigId = service.authConfigId()
  const toolkitSlug = service.toolkitSlug()
  const callbackUrl = process.env[`COMPOSIO_${service.key.toUpperCase()}_CALLBACK_URL`]

  if (authConfigId) {
    // Fast path: auth config ID is known.
    // Skip the check when force=true (tool already failed — re-initiate OAuth).
    if (!forceInitiate) {
      const existing = await client.connectedAccounts.list({
        userIds: [userId],
        authConfigIds: [authConfigId],
        statuses: ['ACTIVE'],
      })
      const items = Array.isArray(existing?.items) ? existing.items : []
      if (items.length > 0) return { connected: true }
    }

    const connRequest = await client.connectedAccounts.initiate(
      userId,
      authConfigId,
      callbackUrl ? { callbackUrl } : {}
    )
    return { connected: false, redirectUrl: connRequest.redirectUrl, serviceLabel: service.label }
  }

  // ── Fallback: no authConfigId configured ────────────────────────────────────
  // Skip the list-based check when force=true — we already know execution failed.
  if (!forceInitiate) {
    let alreadyConnected = false
    try {
      const all = await client.connectedAccounts.list({ userIds: [userId], statuses: ['ACTIVE'] })
      const items = Array.isArray(all?.items) ? all.items : []
      const lc = toolkitSlug.toLowerCase()
      alreadyConnected = items.some(c => {
        const tk = (c.toolkit?.slug || c.toolkit?.name || c.appName || c.app || '').toLowerCase()
        return tk === lc || tk.replace(/[^a-z]/g, '') === lc.replace(/[^a-z]/g, '')
      })
    } catch (e) {
      console.error(`[COMPOSIO] Connection list failed for ${service.label}:`, e.message)
      // Fall through to auth config lookup — don't assume connected
    }
    if (alreadyConnected) return { connected: true }
  }

  // Not connected (or forced) — find an auth config for this toolkit and initiate OAuth.
  // Try the exact toolkit slug first, then lowercase (Composio can be case-sensitive).
  const slugsToTry = [...new Set([toolkitSlug, toolkitSlug.toLowerCase()])]
  for (const slug of slugsToTry) {
    try {
      const authConfigs = await client.authConfigs.list({ toolkitSlug: slug })
      const config = Array.isArray(authConfigs?.items)
        ? authConfigs.items[0]
        : Array.isArray(authConfigs) ? authConfigs[0] : null

      if (config?.id) {
        const connRequest = await client.connectedAccounts.initiate(
          userId,
          config.id,
          callbackUrl ? { callbackUrl } : {}
        )
        console.log(`[COMPOSIO] Initiating OAuth for ${service.label} via auth config ${config.id}`)
        return { connected: false, redirectUrl: connRequest.redirectUrl, serviceLabel: service.label }
      }
    } catch (e) {
      console.error(`[COMPOSIO] Auth config lookup failed for ${slug}:`, e.message)
    }
  }

  // No auth config found — surface a message without a redirect URL
  console.warn(`[COMPOSIO] No auth config found for ${service.label} (${toolkitSlug})`)
  return { connected: false, redirectUrl: null, serviceLabel: service.label }
}
