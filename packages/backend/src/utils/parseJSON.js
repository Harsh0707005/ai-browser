export function parseJSON(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch (e) {}
  const match = text.match(/\{[\s\S]*\}/)
  if (match) { try { return JSON.parse(match[0]) } catch (e) {} }
  return null
}
