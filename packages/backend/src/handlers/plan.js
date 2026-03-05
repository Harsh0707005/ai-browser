import { callLLM } from '../llm/index.js'
import { parseJSON } from '../utils/parseJSON.js'

export async function handlePlan(message, conversationContext, model = 'gemini') {
  console.log(`[PLAN] "${message}" (model: ${model})` + (conversationContext ? ' (with context)' : ''))

  const contextBlock = conversationContext && conversationContext.trim()
    ? `PREVIOUS CONVERSATION CONTEXT (user may be answering a follow-up or continuing):\n${conversationContext.trim()}\n\nCURRENT USER MESSAGE: `
    : 'USER REQUEST: '

  const prompt = `You are an AI browser assistant. First decide: does this request NEED web browsing, or can you answer it directly?
${contextBlock}"${message}"

ANSWER DIRECTLY (no browsing) when:
- Greetings, casual conversation, or chitchat
- The user provides text and asks you to summarize, explain, rewrite, or analyze it
- General knowledge questions you can confidently answer
- Follow-ups about previous results that don't need new browsing
- Anything that does NOT require visiting a website, searching the web, or interacting with a page

USE BROWSING when:
- The user wants to visit, search, or look something up on the web
- The request needs live/current information from websites
- The user wants to interact with a specific site (click, fill forms, etc.)
- Price comparisons, product searches, or anything requiring real web data

If you can answer directly, respond with:
{"type": "direct", "response": "your helpful answer here"}
In the response you may use markdown. For tabular data use a fenced code block with language "table-json" containing a single JSON object with "columns" (array of header strings) and "rows" (array of arrays of cell values).
Accuracy rule for direct answers: never fabricate any number, metric, price, date, name, quote, source, or detail. If you are not sure or do not have a value, clearly say it is unavailable/unknown or omit it.

If browsing is needed, respond with:
{
  "type": "plan",
  "goal": "concise summary of end goal",
  "execution": {
    "startFromCurrentTab": true
  },
  "steps": [
    {"step": 1, "group": 1, "description": "Navigate to example.com and do X"},
    {"step": 2, "group": 1, "description": "Navigate to other.com and do Y"},
    {"step": 3, "group": 2, "description": "Compile results"}
  ]
}

Plan rules (only when type is "plan"):
- Each step has a "group" number. Steps within the same group execute in PARALLEL (each in its own browser tab simultaneously). Steps in different groups execute SEQUENTIALLY (lower group finishes before the next group starts).
- Use the same group for steps that are completely independent of each other. Use different groups when a step depends on a prior step's outcome.
- If the entire task is a linear chain of dependent actions, every step should have a unique group number.
- Each step = a self-contained browser task (may involve navigation + interactions on that page)
- Parallel steps (same group) must each be fully self-contained — include their own navigation since they run in separate tabs
- Break the goal into small, concrete subactions. Avoid large vague steps; prefer short step descriptions that each accomplish one clear objective
- Ensure steps are not repetitive clones: each step should represent a distinct action/progression toward the goal
- Be specific: say exactly what to click, what to type, where to go
- Maximum 10 steps
- If the user's message is a short follow-up (e.g. "yes", "the first one", "try that"), interpret it in light of the previous conversation context
- Set execution.startFromCurrentTab=true when the request is clearly continuing from current page state, prior on-page operations, or recent assistant-led workflow context; otherwise set it to false
- Do not invent facts in step descriptions. If a specific detail is unknown, keep the step generic and evidence-seeking rather than asserting made-up values
- Do not assume site structure in advance (forms, submit flows, selectors, menus, layout). Different sites can be structured or unstructured
- For interactions, plan to first inspect the visible page elements/context, then decide the exact interaction pattern based on what is actually present
- Respond with ONLY valid JSON`

  let text
  try {
    text = await callLLM(prompt, model, { json: true })
  } catch (err) {
    return { success: false, error: err.message }
  }

  const parsed = parseJSON(text)

  if (parsed?.type === 'direct' && parsed.response) {
    console.log(`[PLAN] Direct answer: ${parsed.response.substring(0, 80)}...`)
    return { success: true, direct: true, response: parsed.response }
  }

  if (parsed?.steps) {
    console.log(`[PLAN] ${parsed.steps.length} steps: ${parsed.goal}`)
    return { success: true, plan: parsed }
  }

  if (parsed?.type === 'plan' && parsed.steps) {
    console.log(`[PLAN] ${parsed.steps.length} steps: ${parsed.goal}`)
    return { success: true, plan: parsed }
  }

  return { success: true, plan: { goal: message, steps: [{ step: 1, group: 1, description: message }] } }
}
