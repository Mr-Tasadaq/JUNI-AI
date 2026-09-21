const INPUT_RATE = 16000;
const DEFAULT_CHUNK_MS = 40;

export function resampleFloat32ToPcm16(input, inputRate, targetRate = 16000) {
  if (!(input instanceof Float32Array) || !input.length) return new Int16Array(0);
  if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw voiceError("VOICE_AUDIO_ERROR", "Invalid audio sample rate.");
  }
  if (inputRate === targetRate) return float32ToPcm16(input);
  const outputLength = Math.max(1, Math.floor(input.length * targetRate / inputRate));
  const output = new Int16Array(outputLength);
  const step = inputRate / targetRate;
  for (let i = 0; i < outputLength; i += 1) {
    const position = Math.min(input.length - 1, i * step);
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    const sample = input[left] + (input[right] - input[left]) * fraction;
    output[i] = clampPcm16(sample);
  }
  return output;
}

export function chunkPcm16(pcm, chunkSamples) {
  if (!(pcm instanceof Int16Array) || !Number.isInteger(chunkSamples) || chunkSamples <= 0) {
    throw voiceError("VOICE_AUDIO_ERROR", "Invalid PCM chunk configuration.");
  }
  const chunks = [];
  for (let offset = 0; offset < pcm.length; offset += chunkSamples) {
    const end = Math.min(pcm.length, offset + chunkSamples);
    chunks.push(pcm.slice(offset, end));
  }
  return chunks;
}

function float32ToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) output[i] = clampPcm16(input[i]);
  return output;
}

function clampPcm16(value) {
  const sample = Math.max(-1, Math.min(1, Number(value) || 0));
  return sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
}

export class AudioInput {
  #context;
  #stream;
  #source;
  #worklet;
  #analyser;
  #fallback;
  #onChunk;
  #onLevel;
  #running = false;
  #raf = 0;
  #lastError = null;

  constructor({ chunkMs = DEFAULT_CHUNK_MS, onChunk, onLevel = () => {} } = {}) {
    this.chunkMs = Math.max(20, Math.min(100, Number(chunkMs) || DEFAULT_CHUNK_MS));
    this.#onChunk = onChunk ?? (() => {});
    this.#onLevel = onLevel;
  }

  get context() { return this.#context; }
  get stream() { return this.#stream; }
  get running() { return this.#running; }
  get error() { return this.#lastError; }

  async start() {
    if (this.#running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw voiceError("VOICE_MIC_UNAVAILABLE", "Microphone capture is not available in this browser.");
    this.#context = this.#context ?? new AudioContext({ latencyHint: "interactive" });
    if (this.#context.state === "suspended") await this.#context.resume();

    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      this.#lastError = error;
      throw voiceError("VOICE_PERMISSION_DENIED", "Microphone permission was denied or unavailable.");
    }

    const inputTrack = this.#stream.getAudioTracks()[0];
    if (!inputTrack) {
      this.stop();
      throw voiceError("VOICE_MIC_UNAVAILABLE", "No microphone track was provided.");
    }
    inputTrack.addEventListener("ended", () => {
      if (this.#running) this.#onChunk({ type: "mic-ended" });
    }, { once: true });

    this.#analyser = this.#context.createAnalyser();
    this.#analyser.fftSize = 1024;
    this.#source = this.#context.createMediaStreamSource(this.#stream);
    this.#source.connect(this.#analyser);

    if (this.#context.audioWorklet) {
      try {
        await this.#context.audioWorklet.addModule(new URL("./audio-input-worklet.js", import.meta.url));
        this.#worklet = new AudioWorkletNode(this.#context, "juni-pcm-input", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: {
            inputSampleRate: this.#context.sampleRate,
            targetSampleRate: INPUT_RATE,
            chunkSamples: Math.round(INPUT_RATE * this.chunkMs / 1000),
          },
        });
        this.#worklet.port.onmessage = (event) => {
          if (event.data?.type === "pcm16" && event.data.buffer) this.#onChunk(event.data.buffer);
        };
        this.#source.connect(this.#worklet);
        const sink = this.#context.createGain();
        sink.gain.value = 0;
        this.#worklet.connect(sink).connect(this.#context.destination);
      } catch (error) {
        this.#worklet = null;
        this.#fallback = this.#createFallback();
        this.#source.connect(this.#fallback);
      }
    } else {
      this.#fallback = this.#createFallback();
      this.#source.connect(this.#fallback);
    }

    this.#running = true;
    this.#startLevelLoop();
  }

  #createFallback() {
    if (!this.#context.createScriptProcessor) throw voiceError("VOICE_AUDIO_ERROR", "AudioWorklet is unavailable and no supported fallback exists.");
    const node = this.#context.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = resampleFloat32ToPcm16(input, this.#context.sampleRate, INPUT_RATE);
      this.#onChunk(output.buffer);
    };
    return node;
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

  async stop() {
    this.#running = false;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#worklet?.port.close();
    this.#worklet?.disconnect();
    this.#fallback?.disconnect();
    this.#source?.disconnect();
    this.#analyser?.disconnect();
    for (const track of this.#stream?.getTracks?.() ?? []) track.stop();
    this.#stream = null;
    this.#worklet = null;
    this.#fallback = null;
    this.#source = null;
    this.#analyser = null;
    if (this.#context && this.#context.state !== "closed") {
      try { await this.#context.suspend(); } catch {}
    }
  }
}

function voiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
