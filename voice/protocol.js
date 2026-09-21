export async function decodeSocketData(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  if (data && typeof data === "object") return JSON.stringify(data);
  throw new TypeError("Unsupported Live WebSocket message payload.");
}

export function parseLiveMessage(raw) {
  let message;
  try {
    message = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [{ type: "protocol.error", code: "VOICE_PROTOCOL_ERROR", message: "Malformed JSON from Live service." }];
  }
  if (!message || typeof message !== "object") return [{ type: "protocol.error", code: "VOICE_PROTOCOL_ERROR", message: "Malformed Live message." }];

  const events = [];
  const serverContent = message.serverContent ?? message.server_content;
  if (message.setupComplete ?? message.setup_complete) {
    const setup = message.setupComplete ?? message.setup_complete ?? {};
    events.push({ type: "setup.complete", sessionId: setup.sessionId ?? setup.session_id ?? null });
  }
  if (serverContent && typeof serverContent === "object") {
    const modelTurn = serverContent.modelTurn ?? serverContent.model_turn;
    for (const part of modelTurn?.parts ?? []) {
      const dataPart = part?.inlineData ?? part?.inline_data;
      if (dataPart?.data) {
        events.push({
          type: "audio.output",
          base64: String(dataPart.data),
          mimeType: dataPart.mimeType ?? dataPart.mime_type ?? "audio/pcm;rate=24000",
        });
      }
    }
    const input = serverContent.inputTranscription ?? serverContent.input_transcription;
    if (input?.text != null) events.push({ type: "transcription.input", text: String(input.text), finished: input.finished !== false, languageCode: input.languageCode ?? input.language_code ?? null });
    const interim = serverContent.interimInputTranscription ?? serverContent.interim_input_transcription;
    if (interim?.text != null) events.push({ type: "transcription.input.interim", text: String(interim.text), finished: interim.finished === true, languageCode: interim.languageCode ?? interim.language_code ?? null });
    const output = serverContent.outputTranscription ?? serverContent.output_transcription;
    if (output?.text != null) events.push({ type: "transcription.output", text: String(output.text), finished: output.finished !== false, languageCode: output.languageCode ?? output.language_code ?? null });
    if (serverContent.interactionStatus != null || serverContent.interaction_status != null) {
      const status = serverContent.interactionStatus ?? serverContent.interaction_status;
      events.push({ type: "interaction.status", status: String(status?.value ?? status) });
    }
    if (serverContent.waitingForInput === true || serverContent.waiting_for_input === true) events.push({ type: "waiting.for.input" });
    if (serverContent.generationComplete === true || serverContent.generation_complete === true) events.push({ type: "generation.complete" });
    if (serverContent.turnComplete === true || serverContent.turn_complete === true) events.push({ type: "turn.complete" });
    if (serverContent.interrupted === true) events.push({ type: "interrupted" });
  }

  const toolCall = message.toolCall ?? message.tool_call;
  if (toolCall) {
    const calls = toolCall.functionCalls ?? toolCall.function_calls ?? [];
    events.push({
      type: "tool.call",
      functionCalls: Array.isArray(calls) ? calls.map(normalizeFunctionCall).filter(Boolean) : [],
    });
  }

  const cancelled = message.toolCallCancellation ?? message.tool_call_cancellation;
  if (cancelled) {
    events.push({ type: "tool.call.cancelled", ids: cancelled.ids ?? [] });
  }

  const usage = message.usageMetadata ?? message.usage_metadata;
  if (usage) {
    events.push({
      type: "usage",
      inputTokens: usage.promptTokenCount ?? usage.prompt_token_count ?? null,
      outputTokens: usage.responseTokenCount ?? usage.response_token_count ?? null,
      totalTokens: usage.totalTokenCount ?? usage.total_token_count ?? null,
    });
  }

  const resume = message.sessionResumptionUpdate ?? message.session_resumption_update;
  if (resume) {
    events.push({
      type: "session.resumption.update",
      resumable: resume.resumable === true,
      newHandle: resume.newHandle ?? resume.new_handle ?? null,
      lastConsumedClientMessageIndex: resume.lastConsumedClientMessageIndex ?? resume.last_consumed_client_message_index ?? null,
    });
  }

  const goAway = message.goAway ?? message.go_away;
  if (goAway) {
    events.push({ type: "go.away", timeLeft: goAway.timeLeft ?? goAway.time_left ?? null });
  }

  if (message.error) {
    events.push({
      type: "server.error",
      code: String(message.error.code ?? "VOICE_CONNECTION_FAILED"),
      message: safeServerMessage(message.error.message),
    });
  }

  if (!events.length) events.push({ type: "unknown", keys: Object.keys(message).slice(0, 20) });
  return events;
}

function normalizeFunctionCall(call) {
  if (!call || typeof call !== "object") return null;
  return {
    id: typeof call.id === "string" ? call.id : null,
    name: typeof call.name === "string" ? call.name : "",
    args: call.args && typeof call.args === "object" ? call.args : {},
  };
}

function safeServerMessage(message) {
  const value = String(message ?? "Live service error.");
  return value.length > 240 ? value.slice(0, 240) + "…" : value;
}
