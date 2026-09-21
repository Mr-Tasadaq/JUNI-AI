export function parseLiveServerMessage(raw) {
  let message;
  try {
    message = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return [{ type: "protocol.error", errorCode: "VOICE_PROTOCOL_ERROR", message: "Live message was not an object." }];
    }
  } catch {
    return [{ type: "protocol.error", errorCode: "VOICE_PROTOCOL_ERROR", message: "Live message was not valid JSON." }];
  }

  const events = [];
  if (message.setupComplete) events.push({ type: "setupComplete" });

  const serverContent = message.serverContent ?? message.server_content;
  if (serverContent && typeof serverContent === "object") {
    const modelTurn = serverContent.modelTurn ?? serverContent.model_turn;
    for (const part of modelTurn?.parts ?? []) {
      const inlineData = part?.inlineData ?? part?.inline_data;
      const mimeType = inlineData?.mimeType ?? inlineData?.mime_type ?? "";
      if (inlineData?.data && String(mimeType).toLowerCase().startsWith("audio/")) {
        events.push({
          type: "audio",
          data: String(inlineData.data),
          mimeType: mimeType || "audio/pcm;rate=24000",
        });
      }
    }

    const inputTranscription = serverContent.inputTranscription ?? serverContent.input_transcription;
    if (inputTranscription?.text != null) {
      events.push({
        type: "inputTranscription",
        text: String(inputTranscription.text),
        languageCode: inputTranscription.languageCode ?? inputTranscription.language_code ?? null,
      });
    }

    const interim = serverContent.interimInputTranscription ?? serverContent.interim_input_transcription;
    if (interim?.text != null) {
      events.push({
        type: "interimInputTranscription",
        text: String(interim.text),
        languageCode: interim.languageCode ?? interim.language_code ?? null,
      });
    }

    const outputTranscription = serverContent.outputTranscription ?? serverContent.output_transcription;
    if (outputTranscription?.text != null) {
      events.push({
        type: "outputTranscription",
        text: String(outputTranscription.text),
        languageCode: outputTranscription.languageCode ?? outputTranscription.language_code ?? null,
      });
    }

    if (serverContent.generationComplete ?? serverContent.generation_complete) {
      events.push({ type: "generationComplete" });
    }

    if (serverContent.turnComplete ?? serverContent.turn_complete) {
      events.push({
        type: "turnComplete",
        reason: serverContent.turnCompleteReason ?? serverContent.turn_complete_reason ?? null,
      });
    }

    if (serverContent.interrupted) events.push({ type: "interrupted" });
    if (serverContent.waitingForInput ?? serverContent.waiting_for_input) events.push({ type: "waitingForInput" });

    const interactionStatus = serverContent.interactionStatus ?? serverContent.interaction_status;
    if (interactionStatus != null) {
      events.push({ type: "interactionStatus", status: String(interactionStatus) });
    }
  }

  const topInteractionStatus = message.interactionStatus ?? message.interaction_status;
  if (topInteractionStatus != null) events.push({ type: "interactionStatus", status: String(topInteractionStatus) });

  if (message.toolCall ?? message.tool_call) {
    const call = message.toolCall ?? message.tool_call;
    events.push({
      type: "toolCall",
      functionCalls: normalizeFunctionCalls(call?.functionCalls ?? call?.function_calls),
    });
  }

  if (message.toolCallCancellation ?? message.tool_call_cancellation) {
    const cancellation = message.toolCallCancellation ?? message.tool_call_cancellation;
    events.push({
      type: "toolCallCancellation",
      ids: normalizeStringArray(cancellation?.ids),
    });
  }

  if (message.sessionResumptionUpdate ?? message.session_resumption_update) {
    const update = message.sessionResumptionUpdate ?? message.session_resumption_update;
    events.push({
      type: "sessionResumptionUpdate",
      newHandle: update?.newHandle ?? update?.new_handle ?? null,
      resumable: Boolean(update?.resumable),
    });
  }

  if (message.goAway ?? message.go_away) {
    const goAway = message.goAway ?? message.go_away;
    events.push({
      type: "goAway",
      timeLeft: goAway?.timeLeft ?? goAway?.time_left ?? null,
    });
  }

  if (message.error) {
    events.push({
      type: "error",
      errorCode: message.error.code ?? message.error.status ?? "VOICE_PROVIDER_ERROR",
      message: safeErrorMessage(message.error.message),
    });
  }

  if (message.waitingForInput) events.push({ type: "waitingForInput" });

  if (!events.length) {
    events.push({ type: "unknown", keys: Object.keys(message).slice(0, 20) });
  }

  return events;
}

function normalizeFunctionCalls(value) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map((call) => ({
    id: call?.id == null ? null : String(call.id),
    name: call?.name == null ? "" : String(call.name),
    args: call?.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {},
  }));
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : []).filter((item) => typeof item === "string").slice(0, 20);
}

function safeErrorMessage(value) {
  const text = String(value ?? "Voice provider error.");
  return text.length > 400 ? text.slice(0, 400) + "…" : text;
}

export function buildSetupMessage({
  model,
  includeTranscriptions = false,
  resumptionHandle = null,
  tools = [],
} = {}) {
  if (!model) throw new TypeError("Live model is required.");
  return {
    setup: {
      model: model.startsWith("models/") ? model : "models/" + model,
      responseModalities: ["AUDIO"],
      sessionResumption: resumptionHandle ? { handle: String(resumptionHandle) } : {},
      contextWindowCompression: { slidingWindow: {} },
      tools: tools.length ? [{ functionDeclarations: tools }] : [],
      ...(includeTranscriptions
        ? {
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          }
        : {}),
    },
  };
}

export function buildAudioInputMessage(base64) {
  return {
    realtimeInput: {
      audio: {
        data: String(base64),
        mimeType: "audio/pcm;rate=16000",
      },
    },
  };
}

export function buildToolResponseMessage(functionResponses) {
  return {
    toolResponse: {
      functionResponses: Array.isArray(functionResponses) ? functionResponses.slice(0, 8) : [],
    },
  };
}
