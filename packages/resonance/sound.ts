import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { hash } from "./model";
const scale = [0, 3, 5, 7, 10] as const;

/** Sonification of structure, not generated meaning. Nothing sounds until an explicit enable. */
export class Resonator {
  enabled = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private delay: DelayNode | null = null;
  private wet: GainNode | null = null;
  private generation = 0;
  private voices = new Set<OscillatorNode>();

  async enable(): Promise<void> {
    const generation = ++this.generation;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.22;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 8;
      this.master.connect(compressor); compressor.connect(this.context.destination);
    }
    if (!this.delay) {
      this.delay = this.context.createDelay(1);
      this.delay.delayTime.value = 0.27;
      this.wet = this.context.createGain(); this.wet.gain.value = 0.13;
      this.delay.connect(this.wet); this.wet.connect(this.master!);
      // No feedback loop; stop disconnects this path rather than retaining queued tails.
    }
    await this.context.resume();
    if (generation !== this.generation) return;
    this.enabled = true;
    if (this.master) this.master.gain.setValueAtTime(0.22, this.context.currentTime);
  }

  strike(record: BlockRecord, index = 0): void {
    const ctx = this.context, master = this.master;
    if (!this.enabled || !ctx || !master || !this.delay) return;
    const signal = record.properties.find(p => p.key === "signal")?.values.join("/") ?? record.id;
    const h = hash(signal);
    const midi = 45 + scale[(h + index) % scale.length]! + (record.links.length % 3) * 12;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const now = ctx.currentTime, duration = 0.65 + Math.min(1.4, record.body.length / 900);
    // Limit simultaneous work even when someone scrubs rapidly through the map.
    if (this.voices.size >= 24) this.stopVoices();
    for (let partial = 0; partial < 2; partial++) {
      const oscillator = ctx.createOscillator(), envelope = ctx.createGain(), pan = ctx.createStereoPanner();
      oscillator.type = partial ? "sine" : "triangle";
      oscillator.frequency.value = frequency * (partial ? 2 : 1);
      oscillator.detune.value = partial ? -4 : 3;
      pan.pan.value = (hash(record.id) % 1000) / 500 - 1;
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(partial ? 0.055 : 0.19, now + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(envelope); envelope.connect(pan); pan.connect(master); pan.connect(this.delay);
      this.voices.add(oscillator);
      oscillator.onended = () => {
        this.voices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); pan.disconnect();
      };
      oscillator.start(now); oscillator.stop(now + duration + 0.03);
    }
  }

  private stopVoices(): void {
    for (const oscillator of this.voices) {
      try { oscillator.stop(); } catch { /* An already ended source has nothing to stop. */ }
    }
    this.voices.clear();
  }

  stop(): void {
    this.generation++;
    this.enabled = false;
    this.stopVoices();
    if (this.context && this.master) this.master.gain.setValueAtTime(0, this.context.currentTime);
    this.delay?.disconnect(); this.wet?.disconnect();
    this.delay = null; this.wet = null;
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null; this.master = null; this.delay = null;
  }
}
