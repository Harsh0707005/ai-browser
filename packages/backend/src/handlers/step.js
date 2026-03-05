import { callLLM } from '../llm/index.js'
import { parseJSON } from '../utils/parseJSON.js'
import { formatElements } from '../utils/formatElements.js'

export async function handleStep(data) {
  const model = data.model || 'gemini'
  const { goal, plan, stepIndex, pageContext, currentURL, actionsTakenThisStep, clientDateTime } = data
  const currentStep = plan.steps[stepIndex]

  if (!currentStep) return { success: true, action: 'done', thought: 'All steps completed' }

  console.log(`[STEP ${stepIndex + 1}/${plan.steps.length}] ${currentStep.description}`)

  const elementsFormatted = formatElements(pageContext.elements)
  const alreadyDone = Array.isArray(actionsTakenThisStep) && actionsTakenThisStep.length > 0
    ? `\nACTIONS ALREADY DONE FOR THIS STEP (do not repeat these):\n${actionsTakenThisStep.map(a => `- ${a.action}${a.url ? ' to ' + a.url : ''}${a.elementId != null ? ' element ' + a.elementId : ''}${a.text ? ' "' + a.text + '"' : ''}`).join('\n')}\nIf this step is now complete, return {"action":"done","thought":"reason"}.`
    : ''

  const dateBlock = clientDateTime
    ? `CURRENT DATE/TIME: ${clientDateTime}\nWhen the user uses relative time references (e.g. "in 1 hour", "tomorrow", "next week", "this evening", "after 30 minutes"), resolve them to exact dates/times based on CURRENT DATE/TIME above.\n\n`
    : ''

  const prompt = `You are an AI browser automation agent executing a plan.
${dateBlock}GOAL: "${goal}"

PLAN:
${plan.steps.map(s => `  ${s.step}. ${s.description}`).join('\n')}

CURRENT STEP (${stepIndex + 1} of ${plan.steps.length}): "${currentStep.description}"
${alreadyDone}

CURRENT PAGE:
  URL: ${currentURL || 'about:blank'}
  Title: ${pageContext.title || '(untitled)'}
  Headings: ${(pageContext.headings || []).join(' | ') || '(none)'}
  Visible text excerpt: ${(pageContext.mainText || '').substring(0, 1200) || '(none)'}

INTERACTIVE ELEMENTS:
${elementsFormatted}

Pick ONE action. Use the element [id] number from the list above.

STRICT ACTION SCHEMAS (respond with exactly one):

Navigate to a URL:
{"action":"navigate","url":"https://...","thought":"reason"}

Click element by ID:
{"action":"click","elementId":<number>,"thought":"reason"}

Type into input by ID:
{"action":"type","elementId":<number>,"text":"text to type","thought":"reason"}

Step is complete:
{"action":"done","thought":"reason","result":"optional key info you found that helps answer the user"}

Rules:
- elementId MUST be a number from the [id] column above
- For type: pick the correct input element, provide exact text
- For click: pick the exact button/link element
- Do not assume conventional HTML structure. A flow may use forms, or plain div/button driven UI, or custom widgets. Base actions only on elements actually present in CURRENT PAGE / INTERACTIVE ELEMENTS
- Decide interaction strategy only after inspecting current page context; if unsure, use the safest next exploratory action grounded in visible elements
- If the step is already fulfilled by the current page state, return done
- Do NOT suggest an action already listed in ACTIONS ALREADY DONE FOR THIS STEP
- One action per response then we will ask again; return done when this step is achieved
- If the user's request is informational (recommendations, comparisons, best-of, research), use "result" on done to capture the useful info you learned from the page
- When returning done for research or informational steps, include the current page URL in result so it can be cited (e.g. "Source: <current page URL>" or inline the URL where relevant). Include any other relevant URLs from the page (articles, studies, products) when they support the answer
- Never fabricate numbers, metrics, claims, names, prices, or any factual detail in "thought" or "result". Only include details visible on the current page or already provided in plan/context. If a value is not available, omit it or mark it unknown
- Respond with ONLY the JSON object`

  let text
  try {
    text = await callLLM(prompt, model, { json: true })
  } catch (err) {
    return { success: false, action: 'done', thought: err.message }
  }

  const parsed = parseJSON(text)

  if (parsed?.action) {
    const part = parsed.action === 'navigate'
      ? parsed.url
      : parsed.action === 'type'
        ? `element ${parsed.elementId}, text`
        : parsed.elementId != null ? `element ${parsed.elementId}` : ''
    console.log(`[STEP ${stepIndex + 1}] ${parsed.action}${part ? ': ' + part : ''} | ${parsed.thought || ''}`)
    return { success: true, ...parsed }
  }

  console.error('[STEP] Parse failed:', text)
  return { success: false, action: 'done', thought: 'Could not parse action' }
}
