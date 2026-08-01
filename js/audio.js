export class AudioManager {
  constructor() {
    this.enabled = true;
    this.context = null;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
  }

  ensureContext() {
    if (this.context) return this.context;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    this.context = new Ctor();
    return this.context;
  }

  beep(frequency = 440, duration = 0.08) {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (!context) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = frequency;
    osc.type = 'sine';
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + duration);
  }

  // 単発のビープではなく、ふわっと立ち上がって減衰する1音を鳴らす。
  // 「達成」のような気持ちよさを出したい場面向け(beepより丸い音)。
  tone(frequency, startOffset, duration = 0.18, peakGain = 0.09, type = 'sine') {
    const context = this.ensureContext();
    if (!context) return;
    const startAt = context.currentTime + startOffset;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  // 目標達成など、子どもにとって一番気持ちよくしたい瞬間用の
  // 短い上昇アルペジオ(ドミソ的な3音)。
  chime() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      this.tone(freq, i * 0.075, 0.22, i === notes.length - 1 ? 0.1 : 0.07);
    });
  }

  // バッジやマイルストーンなど、もう一段上の特別感を出したい場面用。
  fanfare() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      this.tone(freq, i * 0.06, 0.3, 0.09, 'triangle');
    });
  }
}
