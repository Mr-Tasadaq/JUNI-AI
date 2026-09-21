export class VoiceAudioOutput {
  #context = null;
  #gain = null;
  #analyser = null;
  #nextPlaybackTime = 0;
  #sources = new Set();
  #maxBufferedSeconds;
  #volume = 1;
  #generation = 0;
  #waiting = false;
  #AudioContext;

  constructor({ maxBufferedMs = 1200, volume = 1, audioContextFactory = null } = {}) {
    if (!Number.isFinite(maxBufferedMs) || maxBufferedMs < 100) throw new TypeError("maxBufferedMs must be at least 100.");
    this.#maxBufferedSeconds = maxBufferedMs / 1000;
    this.#volume = clamp(volume);
    this.#AudioContext = audioContextFactory;
  }

  async start() {
    if (!this.#context) {
      const Context = this.#AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) throw voiceAudioError("VOICE_AUDIO_ERROR", "Web Audio is unavailable in this browser.");
      this.#context = this.#AudioContext
        ? await this.#AudioContext({ latencyHint: "interactive" })
        : new Context({ latencyHint: "interactive" });
      this.#gain = this.#context.createGain();
      this.#gain.gain.value = this.#volume;
      this.#analyser = this.#context.createAnalyser();
      this.#analyser.fftSize = 256;
      this.#gain.connect(this.#analyser);
      this.#analyser.connect(this.#context.destination);
    }
    if (this.#context.state === "suspended") await this.#context.resume();
    return this;
  }

  setVolume(value) {
    this.#volume = clamp(value);
    if (this.#gain) this.#gain.gain.value = this.#volume;
  }

  getLevel() {
    if (!this.#analyser) return 0;
    const data = new Uint8Array(this.#analyser.fftSize);
    this.#analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3.5);
  }

  async playPcm24(base64OrBytes, mimeType = "audio/pcm;rate=24000") {
    await this.start();
    const bytes = typeof base64OrBytes === "string" ? decodeBase64(base64OrBytes) : normalizeBytes(base64OrBytes);
    if (!bytes.byteLength) return { bufferedMs: this.bufferedMs, scheduled: false };
    const sampleRate = parseAudioRate(mimeType) || 24000;
    const evenBytes = bytes.byteLength - (bytes.byteLength % 2);
    const audioBuffer = this.#context.createBuffer(1, Math.floor(evenBytes / 2), sampleRate);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, evenBytes);
    for (let i = 0; i < channel.length; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;

    const generation = this.#generation;
    const source = this.#context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.#gain);
    await this.#waitForCapacity(audioBuffer.duration, generation);
    if (generation !== this.#generation) {
      source.disconnect();
      return { bufferedMs: this.bufferedMs, scheduled: false, obsolete: true };
    }

    const now = this.#context.currentTime;
    const safety = 0.015;
    if (this.#nextPlaybackTime < now + safety) this.#nextPlaybackTime = now + safety;
    source.start(this.#nextPlaybackTime);
    this.#sources.add(source);
    source.addEventListener?.("ended", () => this.#sources.delete(source), { once: true });
    this.#nextPlaybackTime += audioBuffer.duration;
    return { bufferedMs: this.bufferedMs, scheduled: true };
  }

  clear() {
    this.#generation += 1;
    for (const source of this.#sources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    this.#sources.clear();
    this.#nextPlaybackTime = this.#context ? this.#context.currentTime : 0;
  }

  get bufferedMs() {
    if (!this.#context) return 0;
    return Math.max(0, (this.#nextPlaybackTime - this.#context.currentTime) * 1000);
  }

  async close() {
    this.clear();
    try { this.#gain?.disconnect(); } catch {}
    try { this.#analyser?.disconnect(); } catch {}
    try { await this.#context?.close?.(); } catch {}
    this.#context = null;
    this.#gain = null;
    this.#analyser = null;
    this.#nextPlaybackTime = 0;
  }

  async #waitForCapacity(duration, generation) {
    while (generation === this.#generation && this.#context && this.bufferedMs + duration * 1000 > this.#maxBufferedSeconds * 1000) {
      await delay(20);
    }
  }
}

export function decodeBase64(value) {
  const normalized = String(value ?? "").replace(/\s+/g, "");
  if (typeof atob === "function") {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(normalized, "base64"));
  throw new Error("Base64 decoding is unavailable.");
}

export function pcm16ToFloat32(bytes) {
  const data = normalizeBytes(bytes);
  const evenBytes = data.byteLength - (data.byteLength % 2);
  const view = new DataView(data.buffer, data.byteOffset, evenBytes);
  const samples = new Float32Array(evenBytes / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}

export function parseAudioRate(mimeType) {
  const match = String(mimeType).match(/rate\s*=\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("Audio bytes must be Uint8Array or ArrayBuffer.");
}
function clamp(value) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function voiceAudioError(code, message) { const error = new Error(message); error.code = code; return error; }
