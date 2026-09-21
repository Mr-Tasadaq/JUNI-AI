const STORAGE_KEY = "juni-ai-chats-v1";
const THEME_KEY = "juni-ai-theme-v1";

const elements = {
  composer: document.querySelector("#composer"),
  input: document.querySelector("#messageInput"),
  send: document.querySelector("#sendButton"),
  charCount: document.querySelector("#charCount"),
  messages: document.querySelector("#messages"),
  welcome: document.querySelector("#welcomeCard"),
  history: document.querySelector("#historyList"),
  newChat: document.querySelector("#newChatButton"),
  clearHistory: document.querySelector("#clearHistoryButton"),
  exportButton: document.querySelector("#exportButton"),
  themeButton: document.querySelector("#themeButton"),
  themeIcon: document.querySelector("#themeIcon"),
  accessCodeButton: document.querySelector("#accessCodeButton"),
  menuButton: document.querySelector("#menuButton"),
  researchToggle: document.querySelector("#researchToggle"),
  researchHint: document.querySelector("#researchHint"),
  voiceOpenButton: document.querySelector("#voiceOpenButton"),
  voicePanel: document.querySelector("#voicePanel"),
  voiceOrb: document.querySelector("#voiceOrb"),
  voiceState: document.querySelector("#voiceState"),
  voiceSession: document.querySelector("#voiceSession"),
  voiceStartButton: document.querySelector("#voiceStartButton"),
  voiceMuteButton: document.querySelector("#voiceMuteButton"),
  voiceStopButton: document.querySelector("#voiceStopButton"),
  voiceRetryButton: document.querySelector("#voiceRetryButton"),
  voiceCaptionsToggle: document.querySelector("#voiceCaptionsToggle"),
  voiceVolume: document.querySelector("#voiceVolume"),
  voiceCaptions: document.querySelector("#voiceCaptions"),
  voiceCaptionYou: document.querySelector("#voiceCaptionYou"),
  voiceCaptionJuni: document.querySelector("#voiceCaptionJuni"),
  voiceToolOffer: document.querySelector("#voiceToolOffer"),
  voiceToolUrl: document.querySelector("#voiceToolUrl"),
  voiceToolOpen: document.querySelector("#voiceToolOpen"),
  voiceError: document.querySelector("#voiceError"),
  voiceHint: document.querySelector("#voiceHint"),

};

let chats = loadChats();
let activeChatId = chats[0]?.id ?? null;
let isGenerating = false;

let voiceClient = null;
let voicePanelOpen = false;
let voiceToolUrl = null;

if (!activeChatId) {
  activeChatId = createChat();
}

applyStoredTheme();
render();

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage();
});

elements.input.addEventListener("input", () => {
  autoResize();
  updateComposerState();
});

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.input.value = button.dataset.prompt || "";
    updateComposerState();
    autoResize();
    elements.input.focus();
  });
});

elements.newChat.addEventListener("click", () => {
  activeChatId = createChat();
  closeSidebar();
  render();
  elements.input.focus();
});

elements.clearHistory.addEventListener("click", () => {
  const confirmed = window.confirm("Clear all saved conversations from this browser?");
  if (!confirmed) return;
  chats = [];
  activeChatId = createChat();
  saveChats();
  render();
});

elements.exportButton.addEventListener("click", exportActiveChat);

elements.accessCodeButton.addEventListener("click", setAccessCode);

elements.themeButton.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  setTheme(nextTheme);
});

elements.menuButton.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

elements.voiceOpenButton?.addEventListener("click", () => {
  if (voiceClient && !["idle","closed","error"].includes(voiceClient.state)) return;
  voicePanelOpen = !voicePanelOpen;
  if (elements.voicePanel) elements.voicePanel.hidden = !voicePanelOpen;
  elements.voiceOpenButton.setAttribute("aria-expanded", String(voicePanelOpen));
  if (voicePanelOpen) {
    elements.voiceStartButton?.focus();
    loadVoiceClient().catch((error) => showVoiceError(normalizeClientError(error)));
  }
});

elements.voiceStartButton?.addEventListener("click", async () => {
  try {
    const client = await loadVoiceClient();
    clearVoiceError();
    await client.start({ captions: Boolean(elements.voiceCaptionsToggle?.checked) });
  } catch (error) {
    showVoiceError(normalizeClientError(error));
  }
});

elements.voiceMuteButton?.addEventListener("click", async () => {
  try {
    if (!voiceClient) return;
    await voiceClient.setMuted(!voiceClient.muted);
    updateVoiceControls();
  } catch (error) {
    showVoiceError(normalizeClientError(error));
  }
});

elements.voiceStopButton?.addEventListener("click", async () => {
  try {
    await voiceClient?.stop({ reason: "user" });
  } catch (error) {
    showVoiceError(normalizeClientError(error));
  }
});

elements.voiceRetryButton?.addEventListener("click", async () => {
  try {
    clearVoiceError();
    await voiceClient?.retry();
  } catch (error) {
    showVoiceError(normalizeClientError(error));
  }
});

elements.voiceCaptionsToggle?.addEventListener("change", () => {
  voiceClient?.setCaptionsEnabled(Boolean(elements.voiceCaptionsToggle.checked));
  if (voiceClient && voiceClient.state !== "idle" && voiceClient.state !== "closed" && voiceClient.state !== "error") {
    elements.voiceHint.textContent = "Captions changes apply to the next voice connection.";
  }
  updateVoiceControls();
});

elements.voiceVolume?.addEventListener("input", () => {
  voiceClient?.setVolume(Number(elements.voiceVolume.value));
});

elements.voiceToolOpen?.addEventListener("click", () => {
  if (!voiceToolUrl) return;
  const opened = window.open(voiceToolUrl, "_blank", "noopener,noreferrer");
  if (opened) {
    opened.opener = null;
    hideVoiceToolOffer();
  }
});

window.addEventListener("pagehide", () => {
  voiceClient?.stop({ reason: "pagehide" });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) voiceClient?.resume?.().catch(() => {});
});

async function loadVoiceClient() {
  if (voiceClient) return voiceClient;
  const module = await import("./voice/client.js");
  voiceClient = new module.VoiceClient({
    config: {
      captionsEnabled: false,
    },
    onEvent: handleVoiceEvent,
  });
  updateVoiceControls();
  return voiceClient;
}

function handleVoiceEvent(event) {
  const type = event?.type;
  const data = event?.data || {};

  if (type === "voice.state.changed") {
    updateVoiceState(data.state, data.sessionId);
    return;
  }
  if (type === "voice.activity.level") {
    const level = Math.max(0, Math.min(1, Number(data.level) || 0));
    elements.voiceOrb?.style.setProperty("--voice-level", level.toFixed(3));
    return;
  }
  if (type === "voice.caption.input.interim" || type === "voice.caption.input.final") {
    elements.voiceCaptionYou.textContent = data.text ? "YOU · " + data.text : "";
    elements.voiceCaptions.hidden = false;
    return;
  }
  if (type === "voice.caption.output") {
    elements.voiceCaptionJuni.textContent = data.text ? "JUNI · " + data.text : "";
    elements.voiceCaptions.hidden = false;
    return;
  }
  if (type === "voice.tool.offer") {
    showVoiceToolOffer(data.url, data.label);
    return;
  }
  if (type === "voice.session.failed" || type === "voice.session.error") {
    showVoiceError(normalizeClientError({ code: data.code }));
    return;
  }
  if (type === "voice.session.completed") {
    elements.voiceOrb?.style.setProperty("--voice-level", "0");
    if (data.reason === "user" || data.reason === "pagehide") clearVoiceError();
    updateVoiceControls();
  }
  if (type === "voice.session.started") {
    elements.voiceOpenButton?.setAttribute("aria-expanded", "true");
  }
}

function updateVoiceState(state, sessionId = null) {
  const labels = {
    idle: "Idle",
    requesting_permission: "Waiting for microphone permission",
    connecting: "Connecting to Gemini Live",
    listening: "Listening",
    speaking: "Juni is speaking",
    interrupted: "Interrupted · listening",
    reconnecting: "Reconnecting",
    error: "Voice error",
    closing: "Closing",
    closed: "Stopped",
  };
  elements.voiceState.textContent = labels[state] || "Voice";
  elements.voiceSession.textContent = sessionId ? "Session " + sessionId : "No active voice session";

  const active = ["requesting_permission","connecting","listening","speaking","interrupted","reconnecting"].includes(state);
  document.body.classList.toggle("voice-active", active);
  elements.voiceOrb?.style.setProperty("--voice-level", active ? elements.voiceOrb.style.getPropertyValue("--voice-level") || "0" : "0");
  updateVoiceControls();
}

function updateVoiceControls() {
  const state = voiceClient?.state || "idle";
  const active = ["requesting_permission","connecting","listening","speaking","interrupted","reconnecting"].includes(state);
  const busy = ["connecting","requesting_permission","reconnecting"].includes(state);
  const muted = Boolean(voiceClient?.muted);
  elements.voiceStartButton.disabled = Boolean(active);
  elements.voiceMuteButton.disabled = !active || busy;
  elements.voiceStopButton.disabled = !active && state !== "closing";
  elements.voiceRetryButton.hidden = !["error","closed"].includes(state);
  elements.voiceCaptionsToggle.disabled = active;
  elements.voiceMuteButton.textContent = muted ? "Unmute" : "Mute";
  elements.voiceMuteButton.setAttribute("aria-pressed", String(muted));
  if (state === "closed" || state === "idle") {
    elements.voiceCaptions.hidden = !Boolean(elements.voiceCaptionsToggle?.checked);
    elements.voiceCaptionYou.textContent = "";
    elements.voiceCaptionJuni.textContent = "";
    if (state === "closed") hideVoiceToolOffer();
  }
}

function showVoiceToolOffer(url, label) {
  voiceToolUrl = url || null;
  if (!voiceToolUrl) return;
  elements.voiceToolUrl.href = voiceToolUrl;
  elements.voiceToolUrl.textContent = label ? label + " · " + voiceToolUrl : voiceToolUrl;
  elements.voiceToolOffer.classList.add("show");
}

function hideVoiceToolOffer() {
  voiceToolUrl = null;
  elements.voiceToolOffer.classList.remove("show");
  elements.voiceToolUrl.href = "#";
}

function showVoiceError(error) {
  elements.voiceError.textContent = error?.message || "Voice interaction could not continue.";
  elements.voiceError.hidden = false;
  updateVoiceControls();
}

function clearVoiceError() {
  elements.voiceError.hidden = true;
  elements.voiceError.textContent = "";
}

function normalizeClientError(error) {
  const messages = {
    VOICE_FEATURE_DISABLED: "Real-time voice is disabled on this deployment.",
    VOICE_AUTH_REQUIRED: "Enter the JUNI-AI access code before starting voice.",
    VOICE_TOKEN_FAILED: "Voice authentication could not be established.",
    VOICE_PERMISSION_DENIED: "Microphone permission was denied. Allow microphone access and try again.",
    VOICE_MIC_UNAVAILABLE: "No usable microphone is available.",
    VOICE_CONNECTION_FAILED: "Gemini Live could not be reached.",
    VOICE_CONNECTION_CLOSED: "The voice connection closed.",
    VOICE_RECONNECT_FAILED: "Voice reconnect attempts were exhausted. Retry to start a new connection.",
    VOICE_PROTOCOL_ERROR: "The voice service returned an unsupported message.",
    VOICE_AUDIO_ERROR: "The browser audio pipeline failed.",
    VOICE_MODEL_UNSUPPORTED: "The configured Gemini Live model is not supported for realtime voice.",
  };
  return { message: messages[error?.code] || "Voice interaction could not continue." };
}


function createChat() {
  const chat = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title: "New conversation",
    messages: [],
    createdAt: Date.now(),
  };
  chats.unshift(chat);
  saveChats();
  return chat.id;
}

function getActiveChat() {
  return chats.find((chat) => chat.id === activeChatId) || null;
}

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(isValidChat) : [];
  } catch {
    return [];
  }
}

function isValidChat(chat) {
  return chat && typeof chat.id === "string" && Array.isArray(chat.messages);
}

function saveChats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, 30)));
}

function render() {
  const chat = getActiveChat();
  elements.history.replaceChildren();

  if (!chats.length) {
    elements.history.innerHTML = '<div class="history-empty">No saved conversations yet.</div>';
  } else {
    chats.slice(0, 30).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item" + (item.id === activeChatId ? " active" : "");
      button.innerHTML = "";
      
      const title = document.createElement("span");
      title.className = "history-title";
      title.textContent = item.title || "New conversation";

      const preview = document.createElement("span");
      preview.className = "history-preview";
      preview.textContent = item.messages.at(-1)?.content || "No messages yet";

      button.append(title, preview);
      button.addEventListener("click", () => {
        activeChatId = item.id;
        closeSidebar();
        render();
      });
      elements.history.appendChild(button);
    });
  }

  const messages = chat?.messages || [];
  elements.messages.replaceChildren();

  elements.welcome.hidden = messages.length > 0;
  messages.forEach(renderMessage);
  updateComposerState();
}

function renderMessage(message) {
  const row = document.createElement("article");
  row.className = "message " + (message.role === "user" ? "user" : "assistant");

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = message.role === "user" ? "U" : "J";

  const body = document.createElement("div");
  body.className = "message-body";

  const role = document.createElement("div");
  role.className = "message-role";
  role.textContent = message.role === "user" ? "You" : "JUNI-AI";

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = message.content;

  body.append(role, content);

  if (message.research?.sources?.length) {
    const panel = document.createElement("div");
    panel.className = "research-panel";
    const heading = document.createElement("div");
    heading.className = "research-panel-title";
    heading.textContent = "Research sources";
    const list = document.createElement("div");
    list.className = "research-sources";
    message.research.sources.slice(0, 12).forEach((source) => {
      const link = document.createElement("a");
      link.href = source.canonical_url || source.canonicalUrl || source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.title || source.domain || source.url;
      const meta = document.createElement("span");
      meta.textContent = " · " + (source.domain || source.url);
      link.append(meta);
      list.append(link);
    });
    panel.append(heading, list);
    if (message.research.warnings?.length) {
      const warning = document.createElement("div");
      warning.className = "research-warning";
      warning.textContent = message.research.warnings.join(" ");
      panel.append(warning);
    }
    body.append(panel);
  }
  row.append(avatar, body);
  elements.messages.appendChild(row);
}

async function sendMessage() {
  if (isGenerating) return;

  const text = elements.input.value.trim();
  if (!text) return;

  let chat = getActiveChat();
  if (!chat) {
    activeChatId = createChat();
    chat = getActiveChat();
  }

  if (!chat.messages.length) {
    chat.title = text.length > 44 ? text.slice(0, 44) + "…" : text;
  }

  chat.messages.push({
    role: "user",
    content: text,
    createdAt: Date.now(),
  });

  elements.input.value = "";
  autoResize();
  saveChats();
  render();
  const researchEnabled = Boolean(elements.researchToggle?.checked);
  showTyping(researchEnabled);
  isGenerating = true;
  updateComposerState();

  try {
    const response = await requestAssistant(text, chat.messages, researchEnabled);
    chat.messages.push({
      role: "assistant",
      content: response.reply,
      research: response.research ?? null,
      createdAt: Date.now(),
    });
  } catch (error) {
    chat.messages.push({
      role: "assistant",
      content: error?.message || "JUNI-AI could not complete the request. Check the service and try again.",
      createdAt: Date.now(),
    });
    console.error(error);
  } finally {
    isGenerating = false;
    saveChats();
    render();
    elements.input.focus();
  }
}

async function requestAssistant(text, history, researchEnabled = false, allowAuthRetry = true) {
  const payload = researchEnabled
    ? {
        action: "research",
        query: text,
        mode: "RESEARCH",
        citationRequired: true,
        allowKnowledgeCandidate: false,
      }
    : {
        message: text,
        messages: history,
      };

  try {
    const headers = { "Content-Type": "application/json" };
    const response = await fetch(researchEnabled ? "/api/research" : "/api/chat", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = await response.json();
      if (typeof data?.reply === "string" && data.reply.trim()) {
        return { reply: data.reply.trim(), research: null };
      }
      if (researchEnabled && typeof data?.answer === "string") {
        return { reply: data.answer.trim(), research: data };
      }
      throw new Error("The server returned an invalid response.");
    }

    if (response.status === 401) {
      if (!allowAuthRetry) {
        return { reply: "That access code was rejected. Use “Set access code” in the sidebar to update it.", research: null };
      }

      const supplied = window.prompt("Enter your JUNI-AI access code:");
      if (supplied?.trim()) {
        const authenticated = await authenticateWithAccessCode(supplied.trim());
        if (authenticated.ok) return requestAssistant(text, history, researchEnabled, false);
        return { reply: authenticated.error, research: null };
      }
      return { reply: "JUNI-AI needs an access code for the server API. Use “Set access code” in the sidebar.", research: null };
    }

    let errorMessage = `The assistant service returned HTTP ${response.status}.`;
    try {
      const data = await response.json();
      if (typeof data?.error === "string") errorMessage = data.error;
    } catch {
      // Keep the generic HTTP error.
    }
    return { reply: errorMessage, research: null };
  } catch (error) {
    return {
      reply: error?.message || "Unable to reach the JUNI-AI server. Check your network connection or deployment.",
      research: null,
    };
  }
}

async function authenticateWithAccessCode(token) {
  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ token }),
    });

    let message = "Access code could not be accepted.";
    try {
      const data = await response.json();
      if (typeof data?.error === "string") message = data.error;
    } catch {}

    if (!response.ok) return { ok: false, error: message };
    return { ok: true };
  } catch {
    return { ok: false, error: "Unable to reach the authentication service. Check your network connection or deployment." };
  }
}

async function setAccessCode() {
  const next = window.prompt("Enter your JUNI-AI access code:");
  if (next === null) return;

  if (next.trim()) {
    const result = await authenticateWithAccessCode(next.trim());
    window.alert(result.ok ? "Access code saved securely in an HttpOnly session cookie." : result.error);
    return;
  }

  try {
    const response = await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error("Server rejected the access-code clear request.");
    window.alert("Access code cleared.");
  } catch {
    window.alert("Unable to clear the access code because the server could not be reached.");
  }
}

function showTyping(isResearching = false) {
  const row = document.createElement("article");
  row.className = "message assistant";
  row.id = "typingIndicator";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "J";

  const body = document.createElement("div");
  body.className = "message-body";

  const role = document.createElement("div");
  role.className = "message-role";
  role.textContent = isResearching ? "JUNI-AI · researching" : "JUNI-AI";

  const typing = document.createElement("div");
  typing.className = "typing";
  typing.innerHTML = "<span></span><span></span><span></span>";

  body.append(role, typing);
  row.append(avatar, body);
  elements.messages.appendChild(row);
  row.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function updateComposerState() {
  const length = elements.input.value.length;
  elements.charCount.textContent = length + " / 4000";
  elements.send.disabled = isGenerating || !elements.input.value.trim();
}

function autoResize() {
  elements.input.style.height = "auto";
  elements.input.style.height = Math.min(elements.input.scrollHeight, 180) + "px";
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

function applyStoredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const preferred = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  setTheme(saved || preferred);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  elements.themeIcon.textContent = theme === "light" ? "☀" : "☾";
}

function exportActiveChat() {
  const chat = getActiveChat();
  if (!chat || !chat.messages.length) return;

  const output = [
    "# " + (chat.title || "JUNI-AI conversation"),
    "",
    ...chat.messages.map((message) => {
      const role = message.role === "user" ? "You" : "JUNI-AI";
      return "## " + role + "\n\n" + message.content + "\n";
    }),
  ].join("\n");

  const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "juni-ai-chat.md";
  link.click();
  URL.revokeObjectURL(url);
}
