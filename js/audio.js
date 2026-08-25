/**
 * コツコツの森 - オーディオマネージャー
 * Web Audio API を用いた高品質で心地よいサウンド演出と環境音を提供します。
 * 外部音声ファイル（MP3/WAV）のロード・再生にも対応しています。
 */

export class AudioManager {
  constructor() {
    this.enabled = true;
    this.bgmEnabled = false;
    this.context = null;
    this.ambienceOscillators = [];
    this.soundCache = new Map();
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (!this.enabled && this.bgmEnabled) {
      this.stopAmbience();
    }
  }

  setBgmEnabled(value) {
    this.bgmEnabled = Boolean(value);
    if (this.bgmEnabled && this.enabled) {
      this.startAmbience();
    } else {
      this.stopAmbience();
    }
  }

  ensureContext() {
    if (this.context) {
      if (this.context.state === 'suspended') {
        this.context.resume();
      }
      return this.context;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    this.context = new Ctor();
    return this.context;
  }

  // 外部オーディオファイルの再生（あれば使う、無ければWeb Audio合成音）
  async playSoundFile(url) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      let buffer = this.soundCache.get(url);
      if (!buffer) {
        const res = await fetch(url);
        if (!res.ok) return false;
        const arrayBuf = await res.arrayBuffer();
        buffer = await ctx.decodeAudioData(arrayBuf);
        this.soundCache.set(url, buffer);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.3;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
      return true;
    } catch (err) {
      return false;
    }
  }

  tone(frequency, startOffset, duration = 0.18, peakGain = 0.09, type = 'sine') {
    const context = this.ensureContext();
    if (!context) return;
    const startAt = context.currentTime + startOffset;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  beep(frequency = 520, duration = 0.08) {
    if (!this.enabled) return;
    this.tone(frequency, 0, duration, 0.08, 'sine');
  }

  // 木や花を置いたときの「ポコッ」というかわいい配置音
  playPlace() {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const startAt = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // ピッチが急激に下がってマリンバのような打撃感を出す
    osc.frequency.setValueAtTime(420, startAt);
    osc.frequency.exponentialRampToValueAtTime(180, startAt + 0.09);
    gain.gain.setValueAtTime(0.18, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + 0.13);
  }

  // 森の成長イベント（ポロロロ〜ン♪と上昇する木琴のような温かい音）
  playGrow() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;
    const freqs = [329.63, 392.00, 493.88, 587.33, 659.25, 783.99]; // E4, G4, B4, D5, E5, G5
    freqs.forEach((f, i) => {
      this.tone(f, i * 0.06, 0.3, 0.09, 'triangle');
    });
  }

  // きらきらイベント音
  playSparkle() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;
    const freqs = [1046.5, 1318.5, 1567.98, 2093.0]; // C6, E6, G6, C7
    freqs.forEach((f, i) => {
      this.tone(f, i * 0.07, 0.4, 0.07, 'sine');
    });
  }

  // 虹・フィナーレの壮大なファンファーレ
  playRainbow() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;
    const chord1 = [523.25, 659.25, 783.99]; // C
    const chord2 = [587.33, 739.99, 880.0];  // D
    const chord3 = [659.25, 830.61, 987.77]; // E
    const chord4 = [1046.5, 1318.5, 1567.98]; // High C
    chord1.forEach((f) => this.tone(f, 0, 0.35, 0.06, 'triangle'));
    chord2.forEach((f) => this.tone(f, 0.2, 0.35, 0.06, 'triangle'));
    chord3.forEach((f) => this.tone(f, 0.4, 0.45, 0.07, 'triangle'));
    chord4.forEach((f) => this.tone(f, 0.65, 0.8, 0.09, 'triangle'));
  }

  // ありがとうメッセージが届いたときの「チリン♪」ベル音
  playThanks() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;
    this.tone(1318.5, 0, 0.4, 0.08, 'sine'); // E6
    this.tone(1567.98, 0.08, 0.5, 0.1, 'sine'); // G6
    this.tone(2093.0, 0.16, 0.6, 0.09, 'sine'); // C7
  }

  // 目標達成時のキラキラ音
  chime() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      this.tone(freq, i * 0.075, 0.25, i === notes.length - 1 ? 0.12 : 0.08, 'sine');
    });
  }

  // ファンファーレ（森の成長やバッジ獲得）
  fanfare() {
    if (!this.enabled) return;
    if (!this.ensureContext()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      this.tone(freq, i * 0.06, 0.35, 0.1, 'triangle');
    });
  }

  // やさしい森の環境音（小鳥のさえずりとそよ風のアンビエント）
  startAmbience() {
    if (!this.enabled || this.ambienceTimer) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    // 定期的に小鳥の鳴き声をランダム再生
    const chirp = () => {
      if (!this.bgmEnabled || !this.enabled) return;
      const t = ctx.currentTime;
      const baseFreq = 2200 + Math.random() * 600;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq + 400, t + 0.05);
      osc.frequency.exponentialRampToValueAtTime(baseFreq - 200, t + 0.12);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.02, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);

      const nextDelay = 3500 + Math.random() * 6000;
      this.ambienceTimer = window.setTimeout(chirp, nextDelay);
    };

    chirp();
  }

  stopAmbience() {
    if (this.ambienceTimer) {
      window.clearTimeout(this.ambienceTimer);
      this.ambienceTimer = null;
    }
  }
}
