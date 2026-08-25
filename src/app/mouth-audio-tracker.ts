/**
 * MouthAudioTracker — audio-reactive "PNGTuber" mouth driver.
 *
 * Framework-agnostic: it knows nothing about Angular, the DOM avatar, or canvas.
 * It samples the real-time volume of an audio source via the Web Audio API and
 * emits one of three mouth states. Whoever consumes it decides how to *draw*
 * that state (here: swap an <img> src; on a canvas you'd call drawImage).
 *
 *   closed → silence            (Base X - Closed Smile)
 *   small  → low/medium volume  (Base X - Open Talking Small)
 *   large  → high volume/vowels (Base X - Open Talking Large)
 */

export type MouthState = 'closed' | 'small' | 'large';

// ---------------------------------------------------------------------------
// TUNABLES — adjust these to taste.
// ---------------------------------------------------------------------------
export interface MouthTrackerOptions {
  /** RMS amplitude (0..1) above which the mouth opens to at least "small". */
  smallThreshold?: number;
  /** RMS amplitude (0..1) above which the mouth opens "large". */
  largeThreshold?: number;
  /**
   * Anti-jitter hold time (ms). The mouth opens *instantly* on volume, but must
   * stay below a tier for this long before stepping down/closing — this is what
   * stops the violent flicker during rapid speech.
   */
  holdMs?: number;
  /** AnalyserNode smoothing (0..1); higher = smoother but laggier amplitude. */
  smoothing?: number;
  /** FFT size; 1024 is plenty for amplitude tracking. */
  fftSize?: number;
}

const DEFAULTS: Required<MouthTrackerOptions> = {
  smallThreshold: 0.04,
  largeThreshold: 0.13,
  holdMs: 90,
  smoothing: 0.6,
  fftSize: 1024,
};
// ---------------------------------------------------------------------------

/** closed=0, small=1, large=2 — numeric tiers make the hold logic trivial. */
const STATES: MouthState[] = ['closed', 'small', 'large'];

export class MouthAudioTracker {
  private readonly opts: Required<MouthTrackerOptions>;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;
  private rafId: number | null = null;

  // A given media element can only ever back ONE MediaElementSourceNode, so we
  // cache the node per element and reuse it across plays.
  private readonly elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

  // Smoothing state for the hold logic.
  private tier = 0; // current visible tier
  private belowSince = 0; // when amplitude first dropped below `tier` (0 = not below)

  private onState: ((s: MouthState) => void) | null = null;

  constructor(options: MouthTrackerOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /** Live tuning from the console/UI without rebuilding the tracker. */
  set thresholds(t: Partial<Pick<MouthTrackerOptions, 'smallThreshold' | 'largeThreshold' | 'holdMs'>>) {
    Object.assign(this.opts, t);
  }

  // -------------------------------------------------------------------------
  // Source wiring — pick ONE per audio source.
  // -------------------------------------------------------------------------

  /**
   * Connect an <audio>/<video> element (your TTS output). The audio is routed
   * BOTH to the analyser (for volume) and to the speakers, so the user still
   * hears it. *** This is where you inject your live Gemini/TTS audio. ***
   */
  connectElement(el: HTMLMediaElement): void {
    this.ensureContext();
    let src = this.elementSources.get(el);
    if (!src) {
      src = this.ctx!.createMediaElementSource(el);
      this.elementSources.set(el, src);
    }
    src.connect(this.analyser!);
    this.analyser!.connect(this.ctx!.destination); // keep it audible
  }

  /** Connect a raw MediaStream (e.g. a streamed TTS track). Not routed to speakers. */
  connectStream(stream: MediaStream): void {
    this.ensureContext();
    const src = this.ctx!.createMediaStreamSource(stream);
    src.connect(this.analyser!);
  }

  // -------------------------------------------------------------------------
  // Run loop
  // -------------------------------------------------------------------------

  /**
   * Create + resume the AudioContext. MUST be called from within a real user
   * gesture (e.g. a click / form submit). Browsers only let an AudioContext
   * start from a gesture; if it's first resumed inside an async callback, the
   * analyser reads silence even while the audio is audible. Call this on send
   * so the context is already running when TTS audio arrives later.
   */
  unlock(): void {
    this.ensureContext();
    void this.ctx!.resume();
  }

  /** Begin sampling (~60fps). `onState` fires only when the mouth state changes. */
  start(onState: (s: MouthState) => void): void {
    this.ensureContext();
    void this.ctx!.resume(); // required after a user gesture (autoplay policy)
    this.onState = onState;
    this.tier = 0;
    this.belowSince = 0;
    onState('closed');
    if (this.rafId === null) {
      this.loop();
    }
  }

  /** Stop sampling and reset the mouth to closed. */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.tier = 0;
    this.belowSince = 0;
    this.onState?.('closed');
  }

  /** Current RMS amplitude (0..1) — handy for calibrating thresholds live. */
  get amplitude(): number {
    return this.readRms();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensureContext(): void {
    if (this.ctx) {
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.opts.fftSize;
    this.analyser.smoothingTimeConstant = this.opts.smoothing;
    this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
  }

  private loop = (): void => {
    const amp = this.readRms();
    const next = this.resolveTier(amp);
    if (next !== this.tier) {
      this.tier = next;
      this.onState?.(STATES[next]);
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** RMS of the time-domain waveform → perceived loudness in 0..1. */
  private readRms(): number {
    if (!this.analyser || !this.timeData) {
      return 0;
    }
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128; // center & normalize to -1..1
      sum += v * v;
    }
    return Math.sqrt(sum / this.timeData.length);
  }

  /**
   * Map amplitude → tier with anti-jitter hold. Upgrades are instant (snappy
   * onset); downgrades only commit after amplitude has stayed below the current
   * tier for `holdMs`, preventing flicker between frames during speech.
   */
  private resolveTier(amp: number): number {
    const target =
      amp >= this.opts.largeThreshold ? 2 : amp >= this.opts.smallThreshold ? 1 : 0;
    const now = performance.now();

    if (target >= this.tier) {
      this.belowSince = 0;
      return target;
    }
    // target < tier: we want to step down, but only after the hold window.
    if (this.belowSince === 0) {
      this.belowSince = now;
    }
    if (now - this.belowSince >= this.opts.holdMs) {
      this.belowSince = target > 0 ? now : 0;
      return target;
    }
    return this.tier; // still within hold — keep the current (higher) frame
  }
}
