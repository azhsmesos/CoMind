// AudioContext requests 16 kHz. The accumulator also resamples if the device
// supplies another rate, and emits fixed 100 ms PCM16 little-endian packets.
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.sum += value / channels.length;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.samples.push(Math.max(-1, Math.min(1, this.sum / this.count)));
        this.sum = 0;
        this.count = 0;
      }
      if (this.samples.length === 1600) {
        const pcm = new ArrayBuffer(3200);
        const view = new DataView(pcm);
        let energy = 0;
        for (let j = 0; j < 1600; j++) {
          const sample = this.samples[j];
          energy += sample * sample;
          view.setInt16(
            j * 2,
            Math.round(sample * (sample < 0 ? 32768 : 32767)),
            true,
          );
        }
        this.port.postMessage(
          { pcm, level: Math.min(1, Math.sqrt(energy / 1600) * 4) },
          [pcm],
        );
        this.samples = [];
      }
    }
    return true;
  }
}
registerProcessor("comind-pcm", PcmProcessor);
