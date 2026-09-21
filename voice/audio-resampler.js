export class StreamingPcm16Resampler {
  constructor({ inputRate, outputRate = 16000, chunkMs = 60 } = {}) {
    if (!Number.isFinite(inputRate) || inputRate <= 0) throw new TypeError("inputRate must be positive.");
    if (!Number.isFinite(outputRate) || outputRate <= 0) throw new TypeError("outputRate must be positive.");
    if (!Number.isFinite(chunkMs) || chunkMs < 20 || chunkMs > 100) throw new TypeError("chunkMs must be between 20 and 100.");
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.ratio = inputRate / outputRate;
    this.chunkSamples = Math.max(1, Math.round((outputRate * chunkMs) / 1000));
    this.previousSample = 0;
    this.globalInputPosition = 0;
    this.inputFrames = 0;
    this.outputBuffer = new Int16Array(this.chunkSamples);
    this.outputIndex = 0;
  }

  push(frame) {
    if (!(frame instanceof Float32Array) || frame.length === 0) return [];
    const blockStart = this.inputFrames;
    const outputs = [];
    while (true) {
      const local = this.globalInputPosition - blockStart;
      if (local < -1 || local >= frame.length) break;
      const floor = Math.floor(local);
      const frac = local - floor;
      let left;
      let right;
      if (floor < 0) {
        left = this.previousSample;
        right = finiteSample(frame[0]);
      } else if (floor >= frame.length - 1) {
        break;
      } else {
        left = finiteSample(frame[floor]);
        right = finiteSample(frame[floor + 1]);
      }
      this.outputBuffer[this.outputIndex++] = floatToPcm16(left + ((right - left) * frac));
      this.globalInputPosition += this.ratio;
      if (this.outputIndex >= this.chunkSamples) {
        outputs.push(this.outputBuffer.buffer);
        this.outputBuffer = new Int16Array(this.chunkSamples);
        this.outputIndex = 0;
      }
    }
    this.previousSample = finiteSample(frame[frame.length - 1]);
    this.inputFrames += frame.length;
    return outputs;
  }

  flush() {
    if (!this.outputIndex) return null;
    const output = this.outputBuffer.slice(0, this.outputIndex).buffer;
    this.outputBuffer = new Int16Array(this.chunkSamples);
    this.outputIndex = 0;
    return output;
  }
}

function finiteSample(value) { return Number.isFinite(value) ? value : 0; }

export function floatToPcm16(value) {
  const sample = finiteSample(value) > 1 ? 1 : finiteSample(value) < -1 ? -1 : finiteSample(value);
  return sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
}
