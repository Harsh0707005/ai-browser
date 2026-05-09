import { callLLM } from '../llm/index.js'
import { parseJSON } from '../utils/parseJSON.js'
import { formatElements } from '../utils/formatElements.js'

export async function handleStep(data) {
  const model = data.model || 'gemini'
  const {
    goal,
    plan,
    currentStepIndex,
    completedStepsHistory,
    actionsThisStep,
    pageContext,
    currentURL,
    clientDateTime,
  } = data

  const currentStep = plan.steps[currentStepIndex]
  if (!currentStep) return { success: true, type: 'step_complete', finding: '', thought: 'All steps completed' }

  console.log(`[STEP ${currentStepIndex + 1}/${plan.steps.length}] "${currentStep.description}"`)

  // ── Plan status block ────────────────────────────────────────────────────
  const planStatus = plan.steps.map(s => {
    const idx = s.step - 1
    const done = Array.isArray(completedStepsHistory) && completedStepsHistory.some(h => h.stepIndex === idx)
    const isCurrent = idx === currentStepIndex
    const icon = done ? '✓' : isCurrent ? '→' : '○'
    const label = done ? '[COMPLETED]' : isCurrent ? '[CURRENT]' : '[PENDING]'
    return `  ${icon} Step ${s.step}: ${s.description} ${label}`
  }).join('\n')

  // ── Completed steps summary ──────────────────────────────────────────────
  const completedSummary = Array.isArray(completedStepsHistory) && completedStepsHistory.length > 0
    ? completedStepsHistory.map(h => {
        const finding = h.finding ? ` → ${h.finding}` : ' → (no finding recorded)'
        return `  Step ${h.stepIndex + 1} (${h.description}):${finding}`
      }).join('\n')
    : '  None — this is the first step.'

  // ── Actions taken in this step so far ───────────────────────────────────
  const actionsBlock = Array.isArray(actionsThisStep) && actionsThisStep.length > 0
    ? actionsThisStep.map((a, i) => {
        const details = a.action === 'navigate'
          ? `→ ${a.url}`
          : a.action === 'type'
            ? `→ element [${a.elementId}], typed "${a.text}"`
            : a.action === 'click'
              ? `→ element [${a.elementId}]`
              : ''
        const outcome = a.outcome || 'success'
        const thought = a.thought ? ` (${a.thought})` : ''
        return `  ${i + 1}. ${a.action} ${details} [${outcome}]${thought}`
      }).join('\n')
    : '  None — decide the first action.'

  const elementsFormatted = formatElements(pageContext.elements)

  const dateBlock = clientDateTime
    ? `CURRENT DATE/TIME: ${clientDateTime}\n\n`
    : ''

  const prompt = `You are an AI browser execution agent responsible for completing one step of a larger plan.
${dateBlock}OVERALL GOAL: "${goal}"

PLAN STATUS:
${planStatus}

COMPLETED STEPS SUMMARY:
${completedSummary}

CURRENT STEP GOAL (Step ${currentStepIndex + 1}): "${currentStep.description}"

ACTIONS TAKEN IN THIS STEP SO FAR:
${actionsBlock}

CURRENT PAGE STATE:
  URL: ${currentURL || 'about:blank'}
  Title: ${pageContext.title || '(untitled)'}
  Headings: ${(pageContext.headings || []).join(' | ') || '(none)'}
  Page content: ${(pageContext.mainText || '').substring(0, 1500) || '(none)'}

INTERACTIVE ELEMENTS:
${elementsFormatted}

---

DECISION: Carefully evaluate whether the current step goal has been achieved based on the current page state and actions taken so far.

If the step goal IS achieved — return step_complete:
{"type":"step_complete","finding":"<concise summary of what was accomplished or found — include specific data, values, URLs as evidence>","thought":"<why this step is done>"}

If the step goal is NOT yet achieved — return the single best next action:
{"type":"action","action":"navigate","url":"https://...","thought":"<reason>"}
{"type":"action","action":"click","elementId":<number>,"thought":"<reason>"}
{"type":"action","action":"type","elementId":<number>,"text":"<exact text to type>","thought":"<reason>"}

Rules:
- elementId MUST be a number from the INTERACTIVE ELEMENTS list above
- Do not repeat an action that already succeeded in ACTIONS TAKEN IN THIS STEP
- If a previous action failed, try a different approach — do not retry the exact same way
- Base all decisions only on what is actually visible in CURRENT PAGE STATE and INTERACTIVE ELEMENTS
- For research or informational steps, capture key findings with source URLs in "finding"
- Never fabricate any data, numbers, names, prices, or facts not visible on the current page
- Respond with ONLY valid JSON`

  let text
  try {
    text = await callLLM(prompt, model, { json: true })
  } catch (err) {
    return { success: false, type: 'action', action: 'done', thought: err.message }
  }

  const parsed = parseJSON(text)

  if (parsed?.type === 'step_complete') {
    console.log(`[STEP ${currentStepIndex + 1}] COMPLETE | ${parsed.thought || ''}`)
    return { success: true, type: 'step_complete', finding: parsed.finding || '', thought: parsed.thought || '' }
  }

  if (parsed?.type === 'action' && parsed.action) {
    const part = parsed.action === 'navigate'
      ? parsed.url
      : parsed.action === 'type'
        ? `element ${parsed.elementId}, text "${parsed.text}"`
        : parsed.elementId != null ? `element ${parsed.elementId}` : ''
    console.log(`[STEP ${currentStepIndex + 1}] ${parsed.action}${part ? ': ' + part : ''} | ${parsed.thought || ''}`)
    return { success: true, ...parsed }
  }

  console.error('[STEP] Parse failed:', text)
  return { success: false, type: 'action', action: 'done', thought: 'Could not parse action' }
}
