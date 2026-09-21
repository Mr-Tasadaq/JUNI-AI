const OUTPUT_RATE = 24000;

export class AudioOutput {
  #context;
  #gain;
  #analyser;
  #sources = new Set();
  #nextPlaybackTime = 0;
  #bufferedSeconds = 0;
  #bufferLimitMs;
  #onLevel;
  #raf = 0;
  #running = false;

  constructor({ bufferLimitMs = 4000, onLevel = () => {} } = {}) {
    this.#bufferLimitMs = Math.max(500, Math.min(30_000, Number(bufferLimitMs) || 4000));
    this.#onLevel = onLevel;
  }

  get context() { return this.#context; }
  get running() { return this.#running; }
  get bufferedMs() { this.#refreshBufferEstimate(); return this.#bufferedSeconds * 1000; }

  async start() {
    this.#context ??= new AudioContext({ latencyHint: "interactive" });
    if (this.#context.state === "suspended") await this.#context.resume();
    if (!this.#gain) {
      this.#gain = this.#context.createGain();
      this.#gain.gain.value = 1;
      this.#analyser = this.#context.createAnalyser();
      this.#analyser.fftSize = 1024;
      this.#gain.connect(this.#analyser).connect(this.#context.destination);
    }
    this.#running = true;
    this.#startLevelLoop();
  }

  setVolume(value) {
    if (!this.#gain) return;
    this.#gain.gain.value = Math.max(0, Math.min(1, Number(value) || 0));
  }

  async enqueue(base64, mimeType = "audio/pcm;rate=24000") {
    if (!this.#context || !this.#gain) await this.start();
    const { samples, sampleRate } = decodePcm16Base64(base64, mimeType, OUTPUT_RATE);
    if (!samples.length) return;
    const buffer = this.#context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(Float32Array.from(samples, (sample) => sample < 0 ? sample / 32768 : sample / 32767), 0);

    this.#refreshBufferEstimate();
    const now = this.#context.currentTime;
    const safety = 0.02;
    if (this.#nextPlaybackTime < now + safety) this.#nextPlaybackTime = now + safety;
    const duration = buffer.duration;
    const projected = Math.max(0, (this.#nextPlaybackTime + duration - now) * 1000);
    if (projected > this.#bufferLimitMs) {
      const error = new Error("Live audio playback buffer is above the configured limit.");
      error.code = "VOICE_AUDIO_BUFFER_LIMIT";
      error.bufferedMs = projected;
      error.pendingMs = duration * 1000;
      throw error;
    }

    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#gain);
    const startAt = this.#nextPlaybackTime;
    source.start(startAt);
    this.#nextPlaybackTime = startAt + duration;
    this.#bufferedSeconds = projected / 1000;
    this.#sources.add(source);
    source.addEventListener("ended", () => {
      this.#sources.delete(source);
      this.#refreshBufferEstimate();
    }, { once: true });
  }

  clear() {
    for (const source of this.#sources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    this.#sources.clear();
    this.#nextPlaybackTime = this.#context ? this.#context.currentTime : 0;
    this.#bufferedSeconds = 0;
  }

  async suspend() {
    if (this.#context?.state === "running") await this.#context.suspend();
  }

  async resume() {
    if (this.#context?.state === "suspended") await this.#context.resume();
  }

  async close() {
    this.clear();
    this.#running = false;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    try { await this.#context?.close(); } catch {}
    this.#context = null;
    this.#gain = null;
    this.#analyser = null;
  }

  #refreshBufferEstimate() {
    if (!this.#context) { this.#bufferedSeconds = 0; return; }
    this.#bufferedSeconds = Math.max(0, this.#nextPlaybackTime - this.#context.currentTime);
  }

  #startLevelLoop() {
    if (!this.#analyser) return;
    const samples = new Uint8Array(this.#analyser.fftSize);
    const tick = () => {
      if (!this.#running) return;
      this.#analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      this.#onLevel(Math.sqrt(sum / samples.length));
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }
}

export function decodePcm16Base64(base64, mimeType = "audio/pcm;rate=24000", expectedRate = 24000) {
  const match = String(mimeType).match(/rate=(\d+)/i);
  const sampleRate = Number(match?.[1] ?? expectedRate);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw voiceError("VOICE_AUDIO_ERROR", "Invalid Live audio sample rate.");
  }
  const binary = atob(String(base64 ?? ""));
  if (binary.length % 2 !== 0) throw voiceError("VOICE_AUDIO_ERROR", "Malformed PCM16 payload.");
  const samples = new Int16Array(binary.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    const offset = index * 2;
    const low = binary.charCodeAt(offset);
    const high = binary.charCodeAt(offset + 1);
    samples[index] = (high << 8) | low;
  }
  return { samples, sampleRate };
}

function voiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
