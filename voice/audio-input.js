import { StreamingPcm16Resampler } from "./audio-resampler.js";

export class VoiceAudioInput {
  #context = null;
  #stream = null;
  #source = null;
  #node = null;
  #zeroGain = null;
  #analyser = null;
  #processor = null;
  #onChunk;
  #onLevel = null;
  #muted = false;
  #fallback = false;
  #resampler = null;
  #levelFrame = null;
  #AudioContext;

  constructor({ onChunk, onLevel = null, chunkMs = 60, audioContextFactory = null } = {}) {
    if (typeof onChunk !== "function") throw new TypeError("onChunk callback is required.");
    this.#onChunk = onChunk;
    this.#onLevel = onLevel;
    this.chunkMs = chunkMs;
    this.#AudioContext = audioContextFactory;
  }

  get context() { return this.#context; }
  get stream() { return this.#stream; }
  get fallback() { return this.#fallback; }
  get muted() { return this.#muted; }

  async start() {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw voiceAudioError("VOICE_MIC_UNAVAILABLE", "Microphone input is unavailable in this browser.");

    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      const code = error?.name === "NotAllowedError" || error?.name === "SecurityError" ? "VOICE_PERMISSION_DENIED" : "VOICE_MIC_UNAVAILABLE";
      throw voiceAudioError(code, "Microphone access could not be started.");
    }

    try {
      const Context = this.#AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) throw voiceAudioError("VOICE_AUDIO_ERROR", "Web Audio is unavailable in this browser.");
      this.#context = this.#AudioContext
        ? await this.#AudioContext({ latencyHint: "interactive" })
        : new Context({ latencyHint: "interactive" });
      if (this.#context.state === "suspended") await this.#context.resume();
      this.#source = this.#context.createMediaStreamSource(this.#stream);
      this.#analyser = this.#context.createAnalyser();
      this.#analyser.fftSize = 512;
      this.#zeroGain = this.#context.createGain();
      this.#zeroGain.gain.value = 0;
      this.#source.connect(this.#analyser);
      this.#analyser.connect(this.#zeroGain);
      this.#zeroGain.connect(this.#context.destination);

      if (this.#context.audioWorklet?.addModule) {
        await this.#context.audioWorklet.addModule(new URL("./audio-worklet.js", import.meta.url));
        this.#node = new AudioWorkletNode(this.#context, "juni-voice-input", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: { chunkMs: this.chunkMs },
        });
        this.#node.port.onmessage = (event) => {
          const pcm = event.data?.pcm;
          if (pcm instanceof ArrayBuffer && !this.#muted) this.#onChunk(new Uint8Array(pcm));
        };
        this.#source.connect(this.#node);
        this.#node.connect(this.#zeroGain);
        this.#fallback = false;
      } else {
        this.#setupFallback();
      }

      for (const track of this.#stream.getAudioTracks()) {
        track.addEventListener?.("ended", () => this.#onChunk(new Uint8Array(0), { ended: true }));
      }
      this.#processLevel();
      return this;
    } catch (error) {
      await this.close();
      throw error?.code ? error : voiceAudioError("VOICE_AUDIO_ERROR", "Microphone audio pipeline could not be initialized.");
    }
  }

  setMuted(muted) {
    this.#muted = Boolean(muted);
    for (const track of this.#stream?.getAudioTracks?.() ?? []) track.enabled = !this.#muted;
  }

  async resume() {
    if (this.#context?.state === "suspended") await this.#context.resume();
  }

  async close() {
    if (this.#levelFrame != null && globalThis.cancelAnimationFrame) cancelAnimationFrame(this.#levelFrame);
    for (const track of this.#stream?.getTracks?.() ?? []) track.stop();
    try { this.#node?.port?.close?.(); } catch {}
    try { this.#node?.disconnect?.(); } catch {}
    try { this.#processor?.disconnect?.(); } catch {}
    try { this.#source?.disconnect?.(); } catch {}
    try { this.#analyser?.disconnect?.(); } catch {}
    try { this.#zeroGain?.disconnect?.(); } catch {}
    try { await this.#context?.close?.(); } catch {}
    this.#levelFrame = null;
    this.#processor = null;
    this.#node = null;
    this.#source = null;
    this.#analyser = null;
    this.#zeroGain = null;
    this.#stream = null;
    this.#context = null;
    this.#resampler = null;
  }

  getLevel() {
    if (!this.#analyser) return 0;
    const buffer = new Uint8Array(this.#analyser.fftSize);
    this.#analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const value of buffer) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / buffer.length) * 3.5);
  }

  #setupFallback() {
    if (!this.#context.createScriptProcessor) throw voiceAudioError("VOICE_AUDIO_ERROR", "AudioWorklet is unavailable and no compatible audio fallback exists.");
    this.#fallback = true;
    this.#processor = this.#context.createScriptProcessor(2048, 1, 1);
    this.#resampler = new StreamingPcm16Resampler({ inputRate: this.#context.sampleRate, outputRate: 16000, chunkMs: this.chunkMs });
    this.#processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      for (const buffer of this.#resampler.push(channel)) if (!this.#muted) this.#onChunk(new Uint8Array(buffer));
    };
    this.#source.connect(this.#processor);
    this.#processor.connect(this.#zeroGain);
  }

  #processLevel() {
    if (!this.#stream || !this.#onLevel) return;
    this.#onLevel(this.getLevel());
    if (globalThis.requestAnimationFrame) this.#levelFrame = requestAnimationFrame(() => this.#processLevel());
  }
}

function voiceAudioError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
