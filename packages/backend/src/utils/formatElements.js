export function formatElements(elements) {
  if (!elements || !elements.length) return '(no interactive elements found)'
  return elements.map(el => {
    let parts = [`[${el.id}] <${el.tag}>`]
    if (el.type) parts.push(`type=${el.type}`)
    if (el.name) parts.push(`name=${el.name}`)
    if (el.elementId) parts.push(`id=${el.elementId}`)
    if (el.role) parts.push(`role=${el.role}`)
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`)
    if (el.value) parts.push(`value="${el.value}"`)
    if (el.href) parts.push(`href="${el.href}"`)
    if (el.text) parts.push(`text="${el.text}"`)
    if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`)
    if (el.title) parts.push(`title="${el.title}"`)
    return parts.join(' ')
  }).join('\n')
}
