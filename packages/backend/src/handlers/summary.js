import { callLLM } from '../llm/index.js'
import { parseJSON } from '../utils/parseJSON.js'

export async function handleSummary(data) {
  const model = data.model || 'gemini'
  const { userQuery, goal, finalURL, finalPageContext, completedStepsHistory, findings, plan } = data
  const host = finalURL ? (() => { try { return new URL(finalURL).hostname } catch (e) { return finalURL } })() : ''

  // Build findings from completedStepsHistory if available, fall back to legacy findings array
  const findingsText = Array.isArray(completedStepsHistory) && completedStepsHistory.length > 0
    ? completedStepsHistory.map(h => {
        const actionSummary = Array.isArray(h.actions) && h.actions.length > 0
          ? ` (${h.actions.length} action${h.actions.length > 1 ? 's' : ''}: ${h.actions.map(a => a.action).join(' → ')})`
          : ''
        return `- Step ${h.stepIndex + 1} — ${h.description}${actionSummary}\n  Finding: ${h.finding || '(none)'}`
      }).join('\n')
    : Array.isArray(findings) && findings.length
      ? findings.map(f => `- Step ${f.step}: ${String(f.result || '').trim()}${f.url ? ` (on ${f.url})` : ''}`).join('\n')
      : '(no findings recorded)'

  const planText = plan && Array.isArray(plan.steps)
    ? plan.steps.map(s => `- ${s.step}. ${s.description}`).join('\n')
    : '(plan unavailable)'

  const pageText = finalPageContext && typeof finalPageContext === 'object'
    ? `Title: ${finalPageContext.title || '(untitled)'}\nHeadings: ${(finalPageContext.headings || []).join(' | ') || '(none)'}\nVisible text excerpt: ${(finalPageContext.mainText || '').substring(0, 2000) || '(none)'}`
    : '(no page context)'

  const prompt = `You are a helpful browsing assistant. The user asked a question and the agent browsed the web.

Your job: answer the user's request with the best possible final result.
Do NOT narrate what you clicked or typed unless it is directly relevant to the answer.

USER REQUEST:
"${userQuery || goal}"

PLAN (for context):
${planText}

FINDINGS CAPTURED DURING BROWSING:
${findingsText}

CURRENT PAGE (for reference):
Host: ${host || 'unknown'}
${pageText}

Write the final answer to the user:
- Focus on the actual result (recommendations, comparison, key facts, next steps they should take)
- Include relevant sources: cite URLs, links, and references so the user can navigate to them. For research, comparisons, or any factual answer, add clear citations and source links (use markdown links: [description](https://url))
- List or inline any web URLs that were used so the user can open them (products, articles, docs, etc.)
- When your answer includes tabular data (comparisons, prices, lists, etc.), format that table as a JSON object with two keys: "columns" (array of column header strings) and "rows" (array of arrays, each inner array is one row of cell values). Put this JSON inside a fenced code block with language "table-json" so it renders as a proper table.
- If the browsing context doesn't contain enough info to answer fully, say what you found and ask 1 precise follow-up question
- Critical accuracy rule: do NOT fabricate any number, metric, detail, quote, source, or fact. If a detail cannot be verified from findings/page context, do not include it. Be blunt about missing information
- Plain text with optional markdown links; no JSON in the main answer except inside table-json code blocks`

  try {
    const text = await callLLM(prompt, model, { json: false })
    let summary = (text || '').trim()
    if (summary.startsWith('"') && summary.endsWith('"')) summary = summary.slice(1, -1)
    if (!summary) summary = `I couldn't generate a solid answer yet. You're on ${host || 'the page'} now. What should I focus on?`

    const closurePrompt = `Decide whether agent-controlled browser tabs should be closed after this run.

Return ONLY valid JSON:
{"closeTabs":true|false,"reason":"short reason"}

Context:
USER REQUEST:
"${userQuery || goal}"

PLAN:
${planText}

FINDINGS:
${findingsText}

CURRENT PAGE:
Host: ${host || 'unknown'}
${pageText}

FINAL ANSWER DRAFT:
${summary}

Decision policy:
- closeTabs=true only when the task is closed-loop and the user likely does not need to continue interacting on the current page
- closeTabs=false when the task appears open-loop and likely needs user continuation on-page (review/edit/confirm/submit/sign-in/payment/captcha/follow-up interaction)
- Do not rely on assumptions about site structure; decide only from the provided context
- If uncertain, choose closeTabs=false
- Never fabricate details or metrics`

    let closeTabs = false
    let closeTabsReason = 'Kept open by default for potential user continuation'
    try {
      const closureText = await callLLM(closurePrompt, model, { json: true })
      const closureParsed = parseJSON(closureText)
      if (closureParsed && typeof closureParsed.closeTabs === 'boolean') {
        closeTabs = closureParsed.closeTabs
        if (closureParsed.reason && String(closureParsed.reason).trim()) {
          closeTabsReason = String(closureParsed.reason).trim()
        }
      }
    } catch (_) {}

    console.log('[SUMMARY]', summary)
    console.log('[CLOSURE]', closeTabs ? 'close' : 'keep', '|', closeTabsReason)
    return { success: true, summary, closeTabs, closeTabsReason }
  } catch (error) {
    console.error('[SUMMARY] Error:', error.message)
    return { success: false, error: error.message }
  }
}
