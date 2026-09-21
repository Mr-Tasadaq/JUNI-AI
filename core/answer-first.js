const TIME_SENSITIVE_PATTERNS = Object.freeze([
  /\b(?:now|currently|current|latest|today|tonight|tomorrow|yesterday|recent|recently|this week|this month|live|real[- ]?time)\b/i,
  /\b(?:weather|forecast|exchange rate|stock price|share price|price|pricing|availability|schedule|opening hours|open now|traffic)\b/i,
]);

const PERSONAL_PATTERNS = Object.freeze([
  /\b(?:my|mine|our|ours|for me|for us|in my situation|based on my)\b/i,
  /\b(?:account|subscription|billing|order|invoice|payment|profile|preferences|history)\b/i,
  /\bwhat should i do\b/i,
]);

export function answerFirstEligibility({
  message,
  messages = [],
  task = "chat",
  modality = "text",
  requiresWebResearch = false,
  stream = false,
} = {}) {
  const text = String(message ?? "").trim();

  if (!text) return { eligible: false, reason: "empty" };
  if (stream) return { eligible: false, reason: "streaming" };
  if (modality !== "text") return { eligible: false, reason: "non_text_modality" };
  if (task !== "chat") return { eligible: false, reason: "non_chat_task" };
  if (requiresWebResearch) return { eligible: false, reason: "web_research_requested" };
  if (Array.isArray(messages) && messages.length > 0) {
    return { eligible: false, reason: "conversation_dependent" };
  }
  if (TIME_SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { eligible: false, reason: "time_sensitive" };
  }
  if (PERSONAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return { eligible: false, reason: "personalized" };
  }

  return { eligible: true, reason: "safe_exact_candidate" };
}
