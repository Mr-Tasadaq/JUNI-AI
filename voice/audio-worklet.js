import { StreamingPcm16Resampler } from "./audio-resampler.js";

class JuniVoiceInputProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.resampler = new StreamingPcm16Resampler({
      inputRate: sampleRate,
      outputRate: 16000,
      chunkMs: Number(opts.chunkMs) || 60,
    });
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || !input.length) return true;
    for (const buffer of this.resampler.push(input)) this.port.postMessage({ pcm: buffer }, [buffer]);
    return true;
  }
}

registerProcessor("juni-voice-input", JuniVoiceInputProcessor);
