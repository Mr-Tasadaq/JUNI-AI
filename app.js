import { VoiceClient } from "./voice/client.js";
const STORAGE_KEY = "juni-ai-chats-v1";
const THEME_KEY = "juni-ai-theme-v1";
const AUTH_KEY = "juni-ai-access-token-v1";

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
  voiceModeButton: document.querySelector("#voiceModeButton"),
  voicePanel: document.querySelector("#voicePanel"),
  voiceStage: document.querySelector("#voiceStage"),
  voiceOrb: document.querySelector("#voiceOrb"),
  voiceStateLabel: document.querySelector("#voiceStateLabel"),
  voiceHint: document.querySelector("#voiceHint"),
  voiceCaptions: document.querySelector("#voiceCaptions"),
  voiceStartButton: document.querySelector("#voiceStartButton"),
  voiceMuteButton: document.querySelector("#voiceMuteButton"),
  voiceStopButton: document.querySelector("#voiceStopButton"),
  voiceRetryButton: document.querySelector("#voiceRetryButton"),
  voiceClearButton: document.querySelector("#voiceClearButton"),
  voiceVolume: document.querySelector("#voiceVolume"),
  voiceToolOutput: document.querySelector("#voiceToolOutput"),
  voiceError: document.querySelector("#voiceError"),
};

let chats = loadChats();
let activeChatId = chats[0]?.id ?? null;
let isGenerating = false;

const voiceClient = new VoiceClient({
  elements: {
    startButton: elements.voiceStartButton,
    stopButton: elements.voiceStopButton,
    retryButton: elements.voiceRetryButton,
    stateLabel: elements.voiceStateLabel,
    connectionDot: document.querySelector(".voice-connection-dot"),
    voicePanel: elements.voicePanel,
    captionsToggle: elements.voiceCaptionsToggle,
  },
  onState: ({ state, counters }) => {
    updateVoiceUiState(state, counters);
  },
  onCaption: (caption) => {
    if (!elements.voiceCaptions) return;
    const line = document.createElement("div");
    line.className = "voice-caption " + (caption.speaker === "JUNI" ? "juni" : "you") + (caption.finished ? " final" : " interim");
    const label = document.createElement("strong");
    label.textContent = caption.speaker;
    const text = document.createElement("span");
    text.textContent = caption.text;
    line.append(label, text);
    if (caption.finished) elements.voiceCaptions.appendChild(line);
    else {
      const previous = elements.voiceCaptions.querySelector(".interim");
      previous?.replaceWith(line);
      if (!previous) elements.voiceCaptions.appendChild(line);
    }
    elements.voiceCaptions.scrollTop = elements.voiceCaptions.scrollHeight;
  },
  onEvent: (event) => {
    if (event.type === "voice.level.input" && elements.voiceOrb) {
      elements.voiceOrb.style.setProperty("--voice-input-level", String(Math.min(1, Number(event.level) || 0)));
    }
    if (event.type === "voice.level.output" && elements.voiceOrb) {
      elements.voiceOrb.style.setProperty("--voice-output-level", String(Math.min(1, Number(event.level) || 0)));
    }
    if (event.type === "voice.session.resumption.updated" && elements.voiceHint) {
      elements.voiceHint.textContent = "Live session can resume if the connection resets.";
    }
  },
  onOpenWebsite: (url) => {
    elements.voiceToolOutput.hidden = false;
    elements.voiceToolOutput.replaceChildren();
    const label = document.createElement("span");
    label.textContent = "Juni prepared a website: ";
    const link = document.createElement("button");
    link.type = "button";
    link.className = "voice-open-link";
    link.textContent = url;
    link.addEventListener("click", () => {
      window.open(url, "_blank", "noopener,noreferrer");
    }, { once: true });
    elements.voiceToolOutput.append(label, link);
  },
  onError: (error) => {
    if (!elements.voiceError) return;
    elements.voiceError.hidden = false;
    elements.voiceError.textContent = error?.message || "Voice error.";
  },
});

function setVoiceMode(active) {
  const enabled = Boolean(active);
  document.body.classList.toggle("voice-active", enabled);
  elements.voicePanel.hidden = !enabled;
  elements.voiceModeButton.setAttribute("aria-pressed", String(enabled));
  elements.voiceModeButton.textContent = enabled ? "Text mode" : "Voice";
  if (enabled) {
    elements.voiceError.hidden = true;
    elements.voiceHint.textContent = "Press Start voice to grant microphone access.";
    elements.voiceStartButton.focus();
  } else {
    void voiceClient.stop("mode_switched");
    elements.voiceModeButton.focus();
  }
}

function updateVoiceUiState(state, counters = {}) {
  const labels = {
    idle: "Ready",
    requesting_permission: "Waiting for microphone permission",
    connecting: "Connecting to Gemini Live",
    listening: "Listening",
    speaking: "Juni is speaking",
    interrupted: "Listening after interruption",
    reconnecting: "Reconnecting",
    error: "Voice error",
    closing: "Stopping",
    closed: "Voice stopped",
  };
  elements.voiceStateLabel.textContent = labels[state] || state;
  elements.voicePanel.dataset.state = state;
  if (state === "error") elements.voiceHint.textContent = "Voice stopped. Check permissions or connection, then retry.";
  else if (state === "reconnecting") elements.voiceHint.textContent = "Connection interrupted. Preserving the Live session when possible…";
  else if (state === "listening") elements.voiceHint.textContent = "Listening. Speak naturally; Juni responds with audio.";
  else if (state === "speaking") elements.voiceHint.textContent = "Juni is speaking. Start talking to interrupt.";
  elements.voiceStage?.style.setProperty("--voice-input-level", String(Math.min(1, Number(counters.inputLevel) || 0)));
  elements.voiceStage?.style.setProperty("--voice-output-level", String(Math.min(1, Number(counters.outputLevel) || 0)));
  elements.voiceMuteButton.disabled = !["listening", "speaking", "interrupted"].includes(state);
  elements.voiceMuteButton.setAttribute("aria-pressed", String(voiceClient.muted));
  elements.voiceMuteButton.textContent = voiceClient.muted ? "Unmute" : "Mute";
}

elements.voiceModeButton?.addEventListener("click", () => {
  setVoiceMode(document.body.classList.contains("voice-active") === false);
});
elements.voiceStartButton?.addEventListener("click", async () => {
  elements.voiceError.hidden = true;
  await voiceClient.start();
});
elements.voiceStopButton?.addEventListener("click", async () => {
  await voiceClient.stop("user_stopped");
});
elements.voiceRetryButton?.addEventListener("click", async () => {
  elements.voiceError.hidden = true;
  await voiceClient.retry();
});
elements.voiceMuteButton?.addEventListener("click", () => {
  voiceClient.setMuted(!voiceClient.muted);
  updateVoiceUiState(voiceClient.state);
});
elements.voiceCaptionsToggle?.addEventListener("change", (event) => {
  voiceClient.setCaptionsEnabled(event.target.checked);
});
elements.voiceVolume?.addEventListener("input", (event) => {
  voiceClient.setVolume(event.target.value);
});
elements.voiceClearButton?.addEventListener("click", async () => {
  await voiceClient.stop("user_cleared");
  elements.voiceCaptions?.replaceChildren();
  elements.voiceToolOutput.hidden = true;
  elements.voiceError.hidden = true;
  elements.voiceHint.textContent = "Press Start voice to begin a new voice session.";
});


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
      content: "I couldn't reach the assistant service. JUNI-AI is still running in demo mode. Connect your server endpoint at /api/chat to enable a real model.",
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
    const accessToken = localStorage.getItem(AUTH_KEY);
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch(researchEnabled ? "/api/research" : "/api/chat", {
      method: "POST",
      headers,
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
        localStorage.setItem(AUTH_KEY, supplied.trim());
        return requestAssistant(text, history, researchEnabled, false);
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
  } catch {
    return { reply: demoReply(text), research: null };
  }
}

function setAccessCode() {
  const current = localStorage.getItem(AUTH_KEY) || "";
  const next = window.prompt(
    current ? "Update your JUNI-AI access code:" : "Enter your JUNI-AI access code:",
    current
  );

  if (next === null) return;

  if (next.trim()) {
    localStorage.setItem(AUTH_KEY, next.trim());
    window.alert("Access code saved on this device.");
  } else {
    localStorage.removeItem(AUTH_KEY);
    window.alert("Access code cleared.");
  }
}

function demoReply(text) {
  const normalized = text.toLowerCase();

  if (normalized.includes("hello") || normalized.includes("hi")) {
    return "Hello! I’m JUNI-AI. I’m ready to help you plan, write, explain, or brainstorm.";
  }

  if (normalized.includes("project plan") || normalized.includes("website")) {
    return [
      "Here’s a simple starting plan:",
      "1. Define the goal and audience.",
      "2. Sketch the key pages and user flow.",
      "3. Build the core experience first.",
      "4. Test on mobile and desktop.",
      "5. Add analytics, accessibility checks, and deployment.",
    ].join("\n");
  }

  if (normalized.includes("email")) {
    return "Tell me who the email is for, the purpose, and the tone you want. I can turn those details into a polished draft.";
  }

  if (normalized.includes("idea") || normalized.includes("brainstorm")) {
    return "Try narrowing the brainstorm by audience, problem, platform, and time available. A focused prompt usually produces much more useful ideas.";
  }

  return "Demo mode is active. Your message was saved locally. Add the JUNI-AI access code and configure the server environment to enable live AI responses.";
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
