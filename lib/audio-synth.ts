// 100% Procedural Web Audio API Synthesizer for Frostline Plow Co.
// Zero external audio asset dependencies.

class FrostlineAudioSynth {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private lastCrunchTime: number = 0;

  private ensureContext(): AudioContext | null {
    if (this.isMuted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    if (muted && this.windGain && this.ctx) {
      this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public startContinuousEngineAndWind() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (!this.engineOsc) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.value = 48;

      filter.type = 'lowpass';
      filter.frequency.value = 140;
      filter.Q.value = 2.5;

      gain.gain.value = 0.0;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      this.engineOsc = osc;
      this.engineFilter = filter;
      this.engineGain = gain;
    }

    if (!this.windGain) {
      // Procedural white noise buffer for wind loop
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 420;
      filter.Q.value = 4.0;

      const gain = ctx.createGain();
      gain.gain.value = 0.0;

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      whiteNoise.start();

      this.windFilter = filter;
      this.windGain = gain;
    }
  }

  public updateTelemetry(speedRatio: number, snowLoad: number, windStrength: number, active: boolean) {
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.engineOsc && this.engineGain && this.engineFilter) {
      if (!active) {
        this.engineGain.gain.setTargetAtTime(0, now, 0.1);
      } else {
        const targetPitch = 44 + speedRatio * 52 - snowLoad * 10;
        const targetCutoff = 120 + speedRatio * 240 + snowLoad * 90;
        const targetGain = 0.035 + speedRatio * 0.04;
        this.engineOsc.frequency.setTargetAtTime(Math.max(32, targetPitch), now, 0.06);
        this.engineFilter.frequency.setTargetAtTime(targetCutoff, now, 0.06);
        this.engineGain.gain.setTargetAtTime(targetGain, now, 0.08);
      }
    }

    if (this.windGain && this.windFilter) {
      if (!active || windStrength <= 0.1) {
        this.windGain.gain.setTargetAtTime(0.004, now, 0.2);
      } else {
        const lfo = Math.sin(now * 1.4) * 140;
        this.windFilter.frequency.setTargetAtTime(380 + windStrength * 95 + lfo, now, 0.15);
        this.windGain.gain.setTargetAtTime(Math.min(0.06, windStrength * 0.014), now, 0.15);
      }
    }
  }

  public playSnowClear(depth: number, combo: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastCrunchTime < 0.055) return;
    this.lastCrunchTime = now;

    // 1. Tactile snow crunch noise burst
    const duration = 0.06 + depth * 0.025;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.45));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 950 - depth * 160 + Math.min(combo * 25, 500);
    filter.Q.value = 1.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.07 + depth * 0.02, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);

    // 2. Cozy pentatonic synth chime scaled by combo multiplier
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];
    const noteIdx = Math.min(pentatonic.length - 1, Math.floor((combo - 1) % pentatonic.length));
    const octaveBoost = combo >= 10 ? 1.5 : 1.0;
    const freq = pentatonic[noteIdx] * octaveBoost;

    const osc = ctx.createOscillator();
    const bellGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.015, now + 0.11);

    bellGain.gain.setValueAtTime(0.045, now);
    bellGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);

    osc.connect(bellGain);
    bellGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playHeavyDriftImpact() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.18);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playUpgradeSuccess() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.08, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  public playRoundComplete() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const chord = [440, 554.37, 659.25, 880, 1108.73];

    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const start = now + idx * 0.07;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.09, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.58);
    });
  }

  public playCabinCollisionPenalty() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Heavy metallic structural thud
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'sawtooth';
    thudOsc.frequency.setValueAtTime(98, now);
    thudOsc.frequency.exponentialRampToValueAtTime(28, now + 0.24);
    thudGain.gain.setValueAtTime(0.18, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.start(now);
    thudOsc.stop(now + 0.26);

    // 2. Descending warning two-tone alert (penalty cue)
    const tones = [220, 146.83];
    tones.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      const start = now + idx * 0.09;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.055, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.13);
    });
  }

  public playRescueBeaconCleared() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [587.33, 739.99, 880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = now + idx * 0.05;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.085, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.34);
    });
  }

  public playTurboEngage() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.18);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }
}

export const audioSynth = new FrostlineAudioSynth();

