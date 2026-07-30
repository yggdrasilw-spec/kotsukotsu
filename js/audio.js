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
}
