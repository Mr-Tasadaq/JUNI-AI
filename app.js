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
  answerReviewButton: document.querySelector("#answerReviewButton"),
  statusPill: document.querySelector("#statusPill"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  answerModal: document.querySelector("#answerModal"),
  answerModalClose: document.querySelector("#answerModalClose"),
  answerRefreshButton: document.querySelector("#answerRefreshButton"),
  answerCandidateList: document.querySelector("#answerCandidateList"),
  answerReviewStatus: document.querySelector("#answerReviewStatus"),
  composerNotice: document.querySelector("#composerNotice"),
  menuButton: document.querySelector("#menuButton"),
  researchToggle: document.querySelector("#researchToggle"),
  researchHint: document.querySelector("#researchHint"),
  attachButton: document.querySelector("#attachButton"),
  imageInput: document.querySelector("#imageInput"),
  attachmentList: document.querySelector("#attachmentList"),
  voiceButton: document.querySelector("#voiceButton"),
  voiceStatus: document.querySelector("#voiceStatus"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authInput: document.querySelector("#accessCodeInput"),
  authStatus: document.querySelector("#authStatus"),
  authCancelButton: document.querySelector("#authCancelButton"),
};

let chats = loadChats();
let activeChatId = chats[0]?.id ?? null;
let isGenerating = false;

startStartupSequence();
let pendingImages = [];
const voiceState = {
  socket: null,
  mediaStream: null,
  audioContext: null,
  source: null,
  processor: null,
  muteGain: null,
  playbackTime: 0,
  userTranscript: "",
  assistantTranscript: "",
  closing: false,
  microphoneStarted: false,
};

if (!activeChatId) {
  activeChatId = createChat();
}

applyStoredTheme();
render();
refreshServiceStatus();

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
elements.answerReviewButton?.addEventListener("click", openAnswerReview);
elements.answerModalClose?.addEventListener("click", closeAnswerReview);
elements.answerRefreshButton?.addEventListener("click", () => loadAnswerCandidates(true));
elements.answerModal?.addEventListener("click", (event) => {
  if (event.target === elements.answerModal) closeAnswerReview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.answerModal && !elements.answerModal.hidden) closeAnswerReview();
});

elements.attachButton?.addEventListener("click", () => elements.imageInput?.click());
elements.imageInput?.addEventListener("change", handleImageSelection);
elements.voiceButton?.addEventListener("click", toggleVoice);
elements.authForm?.addEventListener("submit", handleAuthSubmit);
elements.authCancelButton?.addEventListener("click", closeAuthGate);

document.querySelectorAll("[data-dashboard-action]").forEach((button) => {
  button.addEventListener("click", () => handleDashboardAction(button.dataset.dashboardAction));
});

elements.themeButton.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  setTheme(nextTheme);
});

elements.menuButton.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

function handleDashboardAction(action) {
  switch (action) {
    case "new-chat":
      activeChatId = createChat();
      render();
      elements.input.focus();
      break;
    case "research":
      if (elements.researchToggle) {
        elements.researchToggle.checked = true;
        elements.researchToggle.dispatchEvent(new Event("change"));
      }
      elements.input.focus();
      break;
    case "voice":
      toggleVoice();
      break;
    case "saved-answers":
      openAnswerReview();
      break;
    case "chat":
      if (elements.researchToggle) {
        elements.researchToggle.checked = false;
        elements.researchToggle.dispatchEvent(new Event("change"));
      }
      elements.input.focus();
      break;
    default:
      break;
  }
}

function startStartupSequence() {
  const screen = document.querySelector("#startupScreen");
  const progress = document.querySelector("#startupProgress");
  const status = document.querySelector("#startupStatus");
  if (!screen) return;

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const setProgress = (value) => {
    if (progress) progress.style.width = value + "%";
  };
  const setStatus = (value) => {
    if (status) status.textContent = value;
  };

  setProgress(12);
  window.requestAnimationFrame(() => setProgress(46));
  window.setTimeout(() => {
    setProgress(78);
    setStatus("Preparing your workspace…");
  }, reducedMotion ? 40 : 260);
  window.setTimeout(() => {
    setProgress(100);
    setStatus("JUNI-AI is ready.");
  }, reducedMotion ? 100 : 650);
  window.setTimeout(() => {
    screen.classList.add("startup-hidden");
    screen.setAttribute("aria-hidden", "true");
    window.setTimeout(() => screen.remove(), reducedMotion ? 0 : 260);
  }, reducedMotion ? 220 : 1100);
}

function openAuthGate(message = "") {
  if (!elements.authGate) return;
  elements.authGate.hidden = false;
  document.body.classList.add("auth-open");
  if (elements.authStatus) elements.authStatus.textContent = message;
  window.setTimeout(() => elements.authInput?.focus(), 30);
}

function closeAuthGate() {
  if (!elements.authGate) return;
  elements.authGate.hidden = true;
  document.body.classList.remove("auth-open");
  if (elements.authStatus) elements.authStatus.textContent = "";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const code = elements.authInput?.value.trim();
  if (!code) return;
  if (elements.authStatus) elements.authStatus.textContent = "Checking access…";
  const result = await authenticateWithAccessCode(code);
  if (result.ok) {
    if (elements.authInput) elements.authInput.value = "";
    closeAuthGate();
    refreshServiceStatus();
  } else if (elements.authStatus) {
    elements.authStatus.textContent = result.error || "Access was rejected. Try again.";
  }
}

function activeConversationId() {
  return getActiveChat()?.id ?? null;
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

  if (Array.isArray(message.attachments) && message.attachments.length) {
    const attachments = document.createElement("div");
    attachments.className = "message-attachments";
    message.attachments.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "message-attachment-chip";
      chip.textContent = item.name || item.mimeType || "Image";
      attachments.appendChild(chip);
    });
    body.append(attachments);
  }

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
    const attachmentsForRequest = pendingImages.slice();
    if (attachmentsForRequest.length) {
      const userMessage = chat.messages.at(-1);
      if (userMessage?.role === "user") {
        userMessage.attachments = attachmentsForRequest.map((item) => ({
          name: item.name,
          mimeType: item.mimeType,
        }));
      }
    }
    pendingImages = [];
    renderAttachmentList();

    const response = await requestAssistant(text, chat.messages, researchEnabled, true, attachmentsForRequest);
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

async function requestAssistant(text, history, researchEnabled = false, allowAuthRetry = true, attachments = []) {
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
        messages: history.slice(0, -1),
        conversationId: activeConversationId(),
        attachments,
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
        if (authenticated.ok) return requestAssistant(text, history, researchEnabled, false, attachments);
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

function renderAttachmentList() {
  if (!elements.attachmentList) return;
  elements.attachmentList.replaceChildren();
  elements.attachmentList.hidden = pendingImages.length === 0;

  pendingImages.forEach((image, index) => {
    const item = document.createElement("span");
    item.className = "attachment-chip";
    item.textContent = image.name || image.mimeType;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.setAttribute("aria-label", "Remove " + (image.name || "image"));
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      pendingImages.splice(index, 1);
      renderAttachmentList();
    });

    item.append(remove);
    elements.attachmentList.append(item);
  });
}

async function handleImageSelection(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";

  if (!files.length) return;

  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const maxBytes = 2 * 1024 * 1024;
  const rejected = [];

  for (const file of files) {
    if (pendingImages.length >= 4) {
      rejected.push("maximum 4 images");
      break;
    }
    if (!allowed.has(file.type)) {
      rejected.push(file.name + " (unsupported type)");
      continue;
    }
    if (file.size <= 0 || file.size > maxBytes) {
      rejected.push(file.name + " (over 2 MB)");
      continue;
    }

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Could not read image."));
        reader.readAsDataURL(file);
      });

      const comma = dataUrl.indexOf(",");
      if (comma < 0) {
        rejected.push(file.name + " (invalid image data)");
        continue;
      }

      pendingImages.push({
        name: file.name,
        mimeType: file.type,
        data: dataUrl.slice(comma + 1),
      });
    } catch {
      rejected.push(file.name + " (could not be read)");
    }
  }

  renderAttachmentList();
  setComposerNotice(
    rejected.length
      ? "Some attachments were skipped: " + rejected.slice(0, 3).join(", ") + (rejected.length > 3 ? "…" : "")
      : "",
    Boolean(rejected.length),
  );
}

function setVoiceStatus(message, visible = true) {
  if (!elements.voiceStatus) return;
  elements.voiceStatus.hidden = !visible;
  elements.voiceStatus.textContent = message;
}

function toggleVoice() {
  if (voiceState.socket && voiceState.socket.readyState <= WebSocket.OPEN) {
    stopVoice();
  } else {
    startVoice();
  }
}

async function startVoice() {
  if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === "undefined") {
    setVoiceStatus("This browser does not support secure voice chat.", true);
    return;
  }

  try {
    setVoiceStatus("Creating a secure voice session…", true);
    elements.voiceButton.disabled = true;

    const tokenResponse = await fetch("/api/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}",
    });

    if (!tokenResponse.ok) {
      let message = "Voice session could not be created.";
      try {
        const data = await tokenResponse.json();
        if (typeof data?.error === "string") message = data.error;
      } catch {}
      throw new Error(message);
    }

    const session = await tokenResponse.json();
    const socket = new WebSocket(session.websocketUrl);
    voiceState.socket = socket;
    voiceState.closing = false;
    voiceState.userTranscript = "";
    voiceState.assistantTranscript = "";
    voiceState.playbackTime = 0;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        setup: {
          model: "models/" + session.model,
          responseModalities: ["AUDIO"],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: {},
          systemInstruction: {
            parts: [{ text: "You are JUNI-AI. Be helpful, concise, and explicit about uncertainty." }],
          },
        },
      }));
      setVoiceStatus("Connecting voice audio…", true);
    };

    socket.onmessage = handleVoiceMessage;
    socket.onerror = () => {
      setVoiceStatus("Voice connection error.", true);
    };
    socket.onclose = () => {
      cleanupVoiceResources();
      if (!voiceState.closing) setVoiceStatus("Voice session closed.", true);
      elements.voiceButton.disabled = false;
      elements.voiceButton.textContent = "◉";
      elements.voiceButton.setAttribute("aria-label", "Start voice chat");
    };
  } catch (error) {
    cleanupVoiceResources();
    elements.voiceButton.disabled = false;
    setVoiceStatus(error?.message || "Voice chat could not start.", true);
  }
}

async function startMicrophoneCapture() {
  voiceState.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("AudioContext is not supported.");
  voiceState.audioContext = new AudioContextClass();
  await voiceState.audioContext.resume();

  voiceState.source = voiceState.audioContext.createMediaStreamSource(voiceState.mediaStream);
  voiceState.processor = voiceState.audioContext.createScriptProcessor(4096, 1, 1);
  voiceState.muteGain = voiceState.audioContext.createGain();
  voiceState.muteGain.gain.value = 0;

  voiceState.processor.onaudioprocess = (event) => {
    if (!voiceState.socket || voiceState.socket.readyState !== WebSocket.OPEN) return;

    const input = event.inputBuffer.getChannelData(0);
    const pcm = downsampleTo16kPcm(input, voiceState.audioContext.sampleRate);
    if (!pcm.length) return;

    const bytes = new Uint8Array(pcm.buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);

    voiceState.socket.send(JSON.stringify({
      realtimeInput: {
        audio: {
          data: btoa(binary),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    }));
  };

  voiceState.source.connect(voiceState.processor);
  voiceState.processor.connect(voiceState.muteGain);
  voiceState.muteGain.connect(voiceState.audioContext.destination);
}

function downsampleTo16kPcm(input, sourceRate) {
  if (sourceRate === 16000) {
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) pcm[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
    return pcm;
  }

  const ratio = sourceRate / 16000;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const pcm = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const position = Math.min(input.length - 1, Math.round(i * ratio));
    const sample = Math.max(-1, Math.min(1, input[position]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

function handleVoiceMessage(event) {
  let response;
  try {
    response = JSON.parse(event.data);
  } catch {
    return;
  }

  if (response.setupComplete && !voiceState.microphoneStarted) {
    startMicrophoneCapture()
      .then(() => {
        voiceState.microphoneStarted = true;
        elements.voiceButton.disabled = false;
        elements.voiceButton.textContent = "■";
        elements.voiceButton.setAttribute("aria-label", "Stop voice chat");
        setVoiceStatus("Voice chat active · speak naturally", true);
      })
      .catch((error) => {
        setVoiceStatus(error?.message || "Microphone access failed.", true);
        stopVoice();
      });
  }

  const content = response.serverContent;
  if (content?.interimInputTranscription?.text) {
    setVoiceStatus("You: " + content.interimInputTranscription.text, true);
  }
  if (content?.inputTranscription?.text) {
    voiceState.userTranscript += content.inputTranscription.text;
    setVoiceStatus("You: " + voiceState.userTranscript.trim(), true);
  }
  if (content?.outputTranscription?.text) {
    voiceState.assistantTranscript += content.outputTranscription.text;
    setVoiceStatus("JUNI-AI: " + voiceState.assistantTranscript.trim(), true);
  }

  for (const part of content?.modelTurn?.parts || []) {
    if (part?.inlineData?.data) {
      playPcm24k(part.inlineData.data);
    }
  }

  if (content?.turnComplete) {
    const chat = getActiveChat();
    if (chat) {
      const userText = voiceState.userTranscript.trim();
      const assistantText = voiceState.assistantTranscript.trim();
      if (userText) chat.messages.push({ role: "user", content: userText, createdAt: Date.now() });
      if (assistantText) chat.messages.push({ role: "assistant", content: assistantText, createdAt: Date.now() });
      saveChats();
      render();
    }
    voiceState.userTranscript = "";
    voiceState.assistantTranscript = "";
  }
}

function playPcm24k(base64) {
  if (!voiceState.audioContext) return;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const buffer = voiceState.audioContext.createBuffer(1, samples.length, 24000);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 32768;

  const source = voiceState.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(voiceState.audioContext.destination);

  const now = voiceState.audioContext.currentTime;
  voiceState.playbackTime = Math.max(now, voiceState.playbackTime);
  source.start(voiceState.playbackTime);
  voiceState.playbackTime += buffer.duration;
}

function stopVoice() {
  voiceState.closing = true;
  try {
    if (voiceState.socket?.readyState === WebSocket.OPEN) {
      voiceState.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    }
    if (voiceState.socket &&
        (voiceState.socket.readyState === WebSocket.OPEN || voiceState.socket.readyState === WebSocket.CONNECTING)) {
      voiceState.socket.close();
    }
  } catch {}
  cleanupVoiceResources();
  elements.voiceButton.disabled = false;
  elements.voiceButton.textContent = "◉";
  elements.voiceButton.setAttribute("aria-label", "Start voice chat");
  setVoiceStatus("Voice chat stopped.", true);
}

function cleanupVoiceResources() {
  voiceState.processor?.disconnect();
  voiceState.source?.disconnect();
  voiceState.muteGain?.disconnect();
  voiceState.mediaStream?.getTracks().forEach((track) => track.stop());
  voiceState.audioContext?.close?.();

  voiceState.socket = null;
  voiceState.processor = null;
  voiceState.source = null;
  voiceState.muteGain = null;
  voiceState.mediaStream = null;
  voiceState.audioContext = null;
  voiceState.playbackTime = 0;
  voiceState.microphoneStarted = false;
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
    if (result.ok) refreshServiceStatus(); else openAuthGate(result.error || "Access was rejected.");
    if (result.ok) refreshServiceStatus();
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
  if (elements.attachButton) elements.attachButton.disabled = isGenerating;
  if (elements.researchToggle) elements.researchToggle.disabled = isGenerating || Boolean(pendingImages.length);
  if (elements.voiceButton && isGenerating) elements.voiceButton.disabled = true;
}

function setComposerNotice(message, visible = true) {
  if (!elements.composerNotice) return;
  elements.composerNotice.hidden = !visible;
  elements.composerNotice.textContent = visible ? message : "";
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


async function refreshServiceStatus() {
  if (!elements.statusText) return;
  try {
    const response = await fetch("/api/health", { credentials: "same-origin", cache: "no-store" });
    let data = null;
    try { data = await response.json(); } catch {}
    const healthy = response.ok && data?.status === "ok";
    const degraded = data?.status === "degraded" || response.status === 503;

    elements.statusText.textContent = healthy ? "Ready" : degraded ? "Limited" : response.status === 401 ? "Sign in" : "Offline";
    elements.statusPill?.classList.toggle("degraded", !healthy && degraded);
    elements.statusPill?.classList.toggle("offline", !healthy && !degraded);

    if (!healthy && response.status !== 401) {
      if (elements.statusPill) {
        elements.statusPill.title = data?.checks?.providers?.length
          ? "One or more backend checks need attention."
          : "The JUNI-AI service is not currently ready.";
      }
    } else if (elements.statusPill) {
      elements.statusPill.title = "";
    }
  } catch {
    elements.statusText.textContent = "Offline";
    elements.statusPill?.classList.add("offline");
  }
}

async function openAnswerReview() {
  if (!elements.answerModal) return;
  elements.answerModal.hidden = false;
  document.body.classList.add("modal-open");
  await loadAnswerCandidates(false);
  elements.answerModalClose?.focus();
}

function closeAnswerReview() {
  if (!elements.answerModal) return;
  elements.answerModal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function loadAnswerCandidates(announceRefresh = false, allowAuthRetry = true) {
  if (!elements.answerCandidateList) return;
  elements.answerCandidateList.replaceChildren();
  if (elements.answerReviewStatus) {
    elements.answerReviewStatus.textContent = announceRefresh ? "Refreshing…" : "Loading…";
  }

  try {
    const response = await fetch("/api/answers?action=candidates&limit=20", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (response.status === 401 && allowAuthRetry) {
      const supplied = window.prompt("Enter your JUNI-AI access code to review saved answers:");
      if (supplied?.trim()) {
        const authenticated = await authenticateWithAccessCode(supplied.trim());
        if (authenticated.ok) return loadAnswerCandidates(announceRefresh, false);
        renderCandidateMessage(authenticated.error);
        return;
      }
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      renderCandidateMessage(data?.error || "Saved answers could not be loaded.");
      return;
    }

    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    if (elements.answerReviewStatus) {
      elements.answerReviewStatus.textContent = candidates.length
        ? candidates.length + " candidate" + (candidates.length === 1 ? "" : "s") + " awaiting review"
        : "No candidates awaiting review";
    }

    if (!candidates.length) {
      renderCandidateMessage("No saved-answer candidates are waiting for approval.");
      return;
    }

    candidates.forEach(renderCandidateCard);
  } catch (error) {
    renderCandidateMessage(error?.message || "Unable to reach the saved-answer service.");
  }
}

function renderCandidateMessage(message) {
  if (!elements.answerCandidateList) return;
  elements.answerCandidateList.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "candidate-empty";
  empty.textContent = message;
  elements.answerCandidateList.append(empty);
  if (elements.answerReviewStatus) elements.answerReviewStatus.textContent = "";
}

function renderCandidateCard(candidate) {
  const card = document.createElement("article");
  card.className = "candidate-card";

  const question = document.createElement("h3");
  question.textContent = candidate.title || "Saved answer candidate";

  const answer = document.createElement("p");
  answer.className = "candidate-answer";
  answer.textContent = candidate.content_text || "No answer text available.";

  const meta = document.createElement("div");
  meta.className = "candidate-meta";
  const created = candidate.created_at ? new Date(candidate.created_at).toLocaleString() : "Unknown time";
  meta.textContent = "Generated " + created + (candidate.source_type ? " · source: " + candidate.source_type : "");

  const actions = document.createElement("div");
  actions.className = "candidate-actions";

  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "secondary-button";
  reject.textContent = "Reject";
  reject.addEventListener("click", () => reviewCandidate(candidate.id, "reject", card));

  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "primary-button";
  approve.textContent = "Approve";
  approve.addEventListener("click", () => reviewCandidate(candidate.id, "approve", card));

  actions.append(reject, approve);
  card.append(question, answer, meta, actions);
  elements.answerCandidateList.append(card);
}

async function reviewCandidate(id, action, card) {
  const buttons = [...card.querySelectorAll("button")];
  buttons.forEach((button) => { button.disabled = true; });

  try {
    const response = await fetch("/api/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "The answer review action was rejected.");
    }

    card.classList.add("candidate-reviewed");
    card.querySelector(".candidate-actions")?.replaceChildren();
    if (elements.answerReviewStatus) {
      elements.answerReviewStatus.textContent = action === "approve"
        ? "Answer approved and indexed for Answer-First use."
        : "Candidate rejected and archived.";
    }
  } catch (error) {
    buttons.forEach((button) => { button.disabled = false; });
    if (elements.answerReviewStatus) {
      elements.answerReviewStatus.textContent = error?.message || "Answer review failed.";
    }
  }
}
