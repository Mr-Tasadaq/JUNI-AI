class JuniPcmInputProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const targetRate = Number(options.processorOptions?.targetSampleRate ?? 16000);
    const inputRate = Number(options.processorOptions?.inputSampleRate ?? sampleRate);
    this.step = Math.max(1e-6, inputRate / targetRate);
    this.chunkSamples = Math.max(320, Math.min(1600, Number(options.processorOptions?.chunkSamples ?? 640)));
    this.buffer = new Float32Array(4096);
    this.length = 0;
    this.position = 0;
    this.chunk = new Int16Array(this.chunkSamples);
    this.chunkLength = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    if (this.length + channel.length >= this.buffer.length) this.compact();
    if (this.length + channel.length >= this.buffer.length) return true;

    this.buffer.set(channel, this.length);
    this.length += channel.length;

    while (this.position + 1 < this.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const sampleA = this.buffer[index];
      const sampleB = this.buffer[index + 1];
      const sample = sampleA + (sampleB - sampleA) * fraction;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.chunk[this.chunkLength++] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      this.position += this.step;

      if (this.chunkLength === this.chunkSamples) {
        const transferable = this.chunk.buffer;
        this.port.postMessage({ type: "pcm16", buffer: transferable, samples: this.chunkSamples }, [transferable]);
        this.chunk = new Int16Array(this.chunkSamples);
        this.chunkLength = 0;
      }
    }

    this.compact();
    return true;
  }

  compact() {
    const consumed = Math.min(this.length - 1, Math.floor(this.position));
    if (consumed <= 0) return;
    this.buffer.copyWithin(0, consumed, this.length);
    this.length -= consumed;
    this.position -= consumed;
  }
}

registerProcessor("juni-pcm-input", JuniPcmInputProcessor);
