import { getClient } from './client.js'
import { SERVICES } from './services.js'

/**
 * Fetches up to 200 tool slugs per active service and returns them grouped.
 * Use the /composio/slugs endpoint to call this and discover real slug names
 * so you can pin them in services.js allowedSlugs.
 *
 * Returns: { [serviceLabel]: string[] }
 */
export async function discoverAllToolSlugs() {
  const client = getClient()
  const active = SERVICES.filter(s => s.authConfigId())
  const result = {}

  await Promise.allSettled(
    active.map(async service => {
      try {
        const toolkitSlug = service.toolkitSlug()
        const raw = await client.tools.getRawComposioTools({ toolkits: [toolkitSlug], limit: 200 })
        const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : []
        const slugs = items.map(t => t.slug || t.name).filter(Boolean).sort()
        result[service.label] = slugs
        console.log(`[DISCOVERY] ${service.label} (${toolkitSlug}): ${slugs.length} tools`)
      } catch (e) {
        result[service.label] = { error: e.message }
        console.error(`[DISCOVERY] ${service.label} failed:`, e.message)
      }
    })
  )

  return result
}
