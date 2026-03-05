import { getClient } from './client.js'
import { SERVICES } from './services.js'

const TOOL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Raw tool objects keyed by slug — lets execute() bypass the internal
// slug→version lookup that errors on "latest" toolkit versions.
const toolObjectCache = new Map()

// LLM-facing slim tool list per service: key → { tools, expiry }
const serviceToolCache = new Map()

// ─── Schema helpers ───────────────────────────────────────────────────────────

function slimParams(inputParameters) {
  if (!inputParameters) return null
  const props = inputParameters.properties ?? inputParameters
  if (typeof props !== 'object') return null
  const required = new Set(inputParameters.required ?? [])
  return Object.entries(props).map(([name, schema]) => ({
    name,
    description: schema.description ?? schema.title ?? '',
    required: required.has(name),
    type: schema.type ?? 'string',
  }))
}

// ─── Fetching ─────────────────────────────────────────────────────────────────

async function fetchServiceTools(service) {
  const cached = serviceToolCache.get(service.key)
  if (cached && Date.now() < cached.expiry) return cached.tools

  const client = getClient()
  const toolkitSlug = service.toolkitSlug()

  // Allowlisted: fetch all with high limit, then filter to exact slugs.
  // No allowlist: cap to toolLimit so Composio's important:true picks the best ones.
  const query = service.allowedSlugs
    ? { toolkits: [toolkitSlug], limit: 200 }
    : { toolkits: [toolkitSlug], limit: service.toolLimit ?? 8 }

  const raw = await client.tools.getRawComposioTools(query)
  const allTools = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : []

  for (const t of allTools) {
    if (t.slug) toolObjectCache.set(t.slug, t)
  }

  const filtered = service.allowedSlugs
    ? allTools.filter(t => service.allowedSlugs.has(t.slug || t.name || ''))
    : allTools

  const slim = filtered.map(t => ({
    slug: t.slug || t.name,
    name: t.name,
    description: t.description,
    parameters: slimParams(t.inputParameters ?? t.parameters),
    service: service.key,
    serviceLabel: service.label,
  }))

  serviceToolCache.set(service.key, { tools: slim, expiry: Date.now() + TOOL_CACHE_TTL })
  console.log(`[COMPOSIO] ${service.label}: ${slim.length} tools cached`)
  return slim
}

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * Fetches tools for a specific list of services (by key), in parallel.
 * Failed services are skipped.
 */
export async function getToolsForServices(serviceKeys) {
  const targets = SERVICES.filter(s => serviceKeys.includes(s.key) && s.authConfigId())
  if (!targets.length) return []

  const results = await Promise.allSettled(targets.map(s => fetchServiceTools(s)))

  const tools = []
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      tools.push(...results[i].value)
    } else {
      console.error(`[COMPOSIO] ${targets[i].label} tool fetch failed:`, results[i].reason?.message)
    }
  }
  return tools
}

/**
 * Execute a Composio tool by slug. Uses cached raw tool objects to bypass the
 * internal slug→version lookup that fails on "latest" toolkit versions.
 * Throws an enriched error that includes any underlying API message.
 */
export async function executeComposioTool(toolSlug, args = {}, userId = 'default') {
  const client = getClient()
  if (!toolSlug) throw new Error('Tool slug is required')

  try {
    const cachedTool = toolObjectCache.get(toolSlug)
    const result = cachedTool
      ? await client.tools.executeComposioTool(cachedTool, {
          userId,
          arguments: args,
          dangerouslySkipVersionCheck: true,
        })
      : await client.tools.execute(toolSlug, {
          userId,
          arguments: args,
          dangerouslySkipVersionCheck: true,
        })

    // Composio wraps API errors in result.error instead of throwing
    if (result && result.successful === false) {
      const detail = result.error ?? JSON.stringify(result)
      throw new Error(detail)
    }

    return result
  } catch (err) {
    // Try to extract a meaningful message from nested error causes
    const message =
      err?.cause?.message ??
      err?.response?.data?.message ??
      err?.response?.data?.error ??
      err?.message ??
      'Unknown error'
    console.error(`[COMPOSIO] executeComposioTool(${toolSlug}) failed:`, message)
    throw new Error(message)
  }
}
