import { Component, ElementRef, afterNextRender, signal, viewChild, viewChildren } from '@angular/core';

import { MouthAudioTracker, MouthState } from './mouth-audio-tracker';
import { Viseme, VisemePlayer, allVisemeSrcs } from './viseme';

type BlinkFrame = 'open' | 'squint' | 'closed';

const ANIM = '/assets/icons/Animation/';
const MOUTH = {
  closedStraight: `${ANIM}Base X - Closed Straight.png`,
  closedSmile: `${ANIM}Base X - Closed Smile.png`,
  openSmile: `${ANIM}Base X - Open Smile.png`,
  // Audio-reactive talking frames (driven by MouthAudioTracker).
  openTalkingSmall: `${ANIM}Base X - Open Talking Small.png`,
  openTalkingLarge: `${ANIM}Base X - Open Talking Large.png`,
};

@Component({
  selector: 'app-animated-head',
  imports: [],
  templateUrl: './animated-head.html',
})
export class AnimatedHead {
  private readonly eyeballs = viewChildren<ElementRef<HTMLImageElement>>('eyeball');
  // Every base/eye frame layer; each carries data-frame="open|squint|closed".
  private readonly blinkFrames = viewChildren<ElementRef<HTMLImageElement>>('blinkFrame');
  private readonly mouth = viewChild<ElementRef<HTMLImageElement>>('mouth');
  // Hidden <audio> used only by the sandbox "Test Audio" button.
  private readonly testAudio = viewChild<ElementRef<HTMLAudioElement>>('testAudio');

  // Audio-reactive lip-sync (volume-based; used by the test button).
  private readonly tracker = new MouthAudioTracker();
  // Viseme lip-sync (text-driven; used for real TTS replies).
  private readonly visemePlayer = new VisemePlayer((src) => this.setMouthSrc(src));
  // True while the tracker owns the mouth, so click gestures don't fight it.
  private talking = false;
  // Toggles the on-screen test button; on via ?avatardebug in the URL.
  protected readonly debug = signal(false);

  // Maximum distance (px) each pupil may drift, kept small so it stays
  // within the white sclera of the Eyes Background layer.
  private readonly maxOffsetX = 6;
  private readonly maxOffsetY = 5;
  // Cursor distance (px) at which the eyes reach their full drift.
  private readonly rampDistance = 300;
  // Cursor distance (px) from the eye line at which the pupils begin to
  // converge inward; only once the cursor is this close — i.e. right between
  // the pupils — do the eyes go fully cross-eyed.
  private readonly crossDistance = 60;
  // Where the convergence point sits vertically within the face art, as a
  // fraction from the top of the box (the eyes, not the box center).
  private readonly eyeLineRatio = 0.32;

  // Circle gesture: if the cursor loops around the face this many full turns
  // within circleWindowMs (and stays within circleRadius of the face), the
  // pupils spiral inside their limits for spiralDurationMs.
  private readonly circleRadius = 200;
  private readonly circleWindowMs = 1600;
  private readonly circleTurnsToTrigger = 2;
  private readonly spiralDurationMs = 2000;
  private readonly spiralTurns = 4;
  // Signed angular deltas (with timestamps) of recent cursor motion around the
  // face; summed to detect a sustained loop.
  private readonly angleSamples: { t: number; delta: number }[] = [];
  private lastAngle: number | null = null;
  private spiraling = false;

  // Per-element applied offset, so each eye tracks from its own resting center.
  private readonly offsets = new WeakMap<HTMLElement, { x: number; y: number }>();

  // Blink cadence: 15 times per minute.
  private readonly blinkIntervalMs = 60_000 / 15;
  private readonly squintMs = 330;
  private readonly closedMs = 420;

  // Mouth: each click toggles the resting expression between "closed straight"
  // and "closed smile"; turning the smile on plays a 2s open-smile flourish.
  private smiling = false;
  private readonly openSmileHoldMs = 2000;
  private readonly toOpenSmileMs = 150;
  private mouthTimers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    // Runs only in the browser (SSR-safe) once the view exists.
    afterNextRender(() => {
      document.addEventListener('mousemove', (event) => this.onMouseMove(event));
      setInterval(() => this.blink(), this.blinkIntervalMs);
      // Preload all mouth frames (base set + viseme set) so src swaps are instant.
      Object.values(MOUTH).forEach((src) => (new Image().src = src));
      allVisemeSrcs().forEach((src) => (new Image().src = src));

      // Show the sandbox test button when the page is opened with ?avatardebug.
      this.debug.set(location.search.includes('avatardebug'));

      // Console helpers:
      //   setFace('open'|'squint'|'closed')          — eye debug (existing)
      //   avatar.test()                               — play the test clip
      //   avatar.tracker.thresholds = { largeThreshold: 0.1 }  — live tuning
      (window as unknown as { setFace: (n: BlinkFrame) => void }).setFace = (n) =>
        this.setFrame(n);
      (window as unknown as { avatar: unknown }).avatar = {
        test: () => this.playTest(),
        tracker: this.tracker,
        speak: (el: HTMLMediaElement) => this.speak(el),
        // Live-tune the mouth hold, e.g. avatar.visemes.minHoldSeconds = 0.15
        visemes: this.visemePlayer,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Public lip-sync API — call these from the chat/TTS code.
  // -------------------------------------------------------------------------

  /**
   * Lip-sync to a TTS/media element and auto-stop when it finishes.
   * *** Inject your live Gemini/TTS audio here: avatar.speak(ttsAudioEl). ***
   */
  speak(el: HTMLMediaElement): void {
    this.tracker.connectElement(el); // route audio → analyser + speakers
    const done = () => {
      el.removeEventListener('ended', done);
      this.stopTalking();
    };
    el.addEventListener('ended', done);
    this.startTalking();
    void el.play();
  }

  /**
   * Text-driven lip-sync: replay a viseme timeline against the audio clock so
   * the mouth shapes match the spoken words. Falls back to volume-based lip-sync
   * if no visemes were provided. *** This is the path used for real TTS. ***
   */
  speakVisemes(el: HTMLMediaElement, frames: Viseme[]): void {
    if (frames.length === 0) {
      this.speak(el);
      return;
    }
    this.talking = true;
    const done = () => {
      el.removeEventListener('ended', done);
      this.stopVisemes();
    };
    el.addEventListener('ended', done);
    this.visemePlayer.play(el, frames, MOUTH.closedSmile);
    void el.play();
  }

  private stopVisemes(): void {
    this.visemePlayer.stop();
    this.talking = false;
    this.setMouth(this.smiling ? 'closedSmile' : 'closedStraight');
  }

  /**
   * Unlock the audio pipeline from within a user gesture (call on send/click),
   * so lip-sync works when TTS audio plays later from an async callback.
   */
  unlock(): void {
    this.tracker.unlock();
  }

  /** Begin driving the mouth from live audio volume. */
  startTalking(): void {
    this.talking = true;
    this.tracker.start((state) => this.setMouth(this.mouthForState(state)));
  }

  /** Stop lip-sync and return to the resting expression. */
  stopTalking(): void {
    this.tracker.stop();
    this.talking = false;
    this.setMouth(this.smiling ? 'closedSmile' : 'closedStraight');
  }

  /** Sandbox: play the bundled test clip through the full lip-sync pipeline. */
  protected playTest(): void {
    const el = this.testAudio()?.nativeElement;
    if (el) {
      el.currentTime = 0;
      this.speak(el);
    }
  }

  private mouthForState(state: MouthState): keyof typeof MOUTH {
    // closed → smile (silence), small/large → the talking frames.
    return state === 'large'
      ? 'openTalkingLarge'
      : state === 'small'
        ? 'openTalkingSmall'
        : 'closedSmile';
  }

  protected onHeadClick(): void {
    // While the avatar is talking, the audio tracker owns the mouth — ignore clicks.
    if (this.talking) {
      return;
    }
    // Cancel any in-flight mouth transition so rapid clicks stay consistent.
    this.mouthTimers.forEach(clearTimeout);
    this.mouthTimers = [];

    if (this.smiling) {
      // Second click: back to the closed-straight default.
      this.smiling = false;
      this.setMouth('closedStraight');
      return;
    }

    // First click: closed straight → closed smile → open smile (2s) → closed smile.
    this.smiling = true;
    this.setMouth('closedSmile');
    this.mouthTimers.push(setTimeout(() => this.setMouth('openSmile'), this.toOpenSmileMs));
    this.mouthTimers.push(
      setTimeout(() => this.setMouth('closedSmile'), this.toOpenSmileMs + this.openSmileHoldMs),
    );
  }

  private setMouth(name: keyof typeof MOUTH): void {
    this.setMouthSrc(MOUTH[name]);
  }

  /** Swap the mouth layer to an arbitrary image URL (used by the viseme player). */
  private setMouthSrc(src: string): void {
    const el = this.mouth()?.nativeElement;
    if (el) {
      el.src = src;
    }
  }

  private blink(): void {
    // Pause blinking while the avatar is talking so the eyes stay engaged.
    if (this.talking) {
      return;
    }
    // Open → squint → closed (hold) → squint → open.
    this.setFrame('squint');
    setTimeout(() => this.setFrame('closed'), this.squintMs);
    setTimeout(() => this.setFrame('squint'), this.squintMs + this.closedMs);
    setTimeout(() => this.setFrame('open'), this.squintMs + this.closedMs + this.squintMs);
  }

  private setFrame(name: BlinkFrame): void {
    // Show only the base/eye frame layers matching `name`; hide the others, so
    // e.g. Base 1 is never visible while Base 3 (or Base 2) is showing.
    // The whites and pupils are persistent layers and stay visible — they show
    // through whatever transparent eye cut-outs the active base/eye art has.
    for (const ref of this.blinkFrames()) {
      const el = ref.nativeElement;
      el.style.visibility = el.dataset['frame'] === name ? 'visible' : 'hidden';
    }
  }

  private onMouseMove(event: MouseEvent): void {
    const refs = this.eyeballs();
    if (refs.length === 0 || this.spiraling) {
      return;
    }

    // Both pupil layers share the same full-canvas bounding box, so the face
    // center is simply that shared box center — it can't tell the eyes apart.
    const rect = refs[0].nativeElement.getBoundingClientRect();
    const current0 = this.offsets.get(refs[0].nativeElement) ?? { x: 0, y: 0 };
    const faceX = rect.left + rect.width / 2 - current0.x;
    const faceY = rect.top + rect.height * this.eyeLineRatio - current0.y;

    // Quick double loop around the face → spiral the pupils.
    if (this.detectCircle(event, faceX, faceY)) {
      this.startSpiral(Math.sign(this.angleSamples.reduce((s, e) => s + e.delta, 0)) || 1);
      this.angleSamples.length = 0;
      this.lastAngle = null;
      return;
    }

    // How close the cursor is to the face: 1 right on the face center, easing
    // to 0 once it passes crossDistance away.
    const faceDist = Math.hypot(event.clientX - faceX, event.clientY - faceY);
    const cross = Math.max(0, 1 - faceDist / this.crossDistance);

    refs.forEach((ref, i) => this.moveEye(ref.nativeElement, i, event, cross));
  }

  /** Tracks circular cursor motion; returns true once two quick loops land. */
  private detectCircle(event: MouseEvent, faceX: number, faceY: number): boolean {
    const dx = event.clientX - faceX;
    const dy = event.clientY - faceY;
    const dist = Math.hypot(dx, dy);
    const now = performance.now();

    // Only count motion that actually circles near the pupils.
    if (dist > this.circleRadius || dist < 4) {
      this.angleSamples.length = 0;
      this.lastAngle = null;
      return false;
    }

    const angle = Math.atan2(dy, dx);
    if (this.lastAngle !== null) {
      let delta = angle - this.lastAngle;
      // Normalize the step to [-π, π] so wrap-around doesn't spike it.
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      this.angleSamples.push({ t: now, delta });
    }
    this.lastAngle = angle;

    // Drop samples older than the window so the loops must be quick.
    const cutoff = now - this.circleWindowMs;
    while (this.angleSamples.length > 0 && this.angleSamples[0].t < cutoff) {
      this.angleSamples.shift();
    }

    const total = this.angleSamples.reduce((sum, e) => sum + e.delta, 0);
    return Math.abs(total) >= this.circleTurnsToTrigger * 2 * Math.PI;
  }

  /** Spins both pupils through an inward spiral within their offset limits. */
  private startSpiral(direction: number): void {
    this.spiraling = true;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min((now - start) / this.spiralDurationMs, 1);
      const radius = 1 - t; // spiral inward to rest
      const angle = direction * t * this.spiralTurns * 2 * Math.PI;
      const x = Math.cos(angle) * this.maxOffsetX * radius;
      const y = Math.sin(angle) * this.maxOffsetY * radius;

      for (const ref of this.eyeballs()) {
        const el = ref.nativeElement;
        this.offsets.set(el, { x, y });
        el.style.transform = `translate(${x}px, ${y}px)`;
      }

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.spiraling = false;
      }
    };

    requestAnimationFrame(step);
  }

  // Flip if the eyes splay outward (wall-eyed) instead of crossing inward.
  private readonly crossInvert = true;

  private moveEye(
    el: HTMLImageElement,
    index: number,
    event: MouseEvent,
    cross: number,
  ): void {
    const currentOffset = this.offsets.get(el) ?? { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    // Undo the currently applied offset so the anchor is the resting center.
    const centerX = rect.left + rect.width / 2 - currentOffset.x;
    const centerY = rect.top + rect.height / 2 - currentOffset.y;

    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    const dist = Math.hypot(dx, dy);

    // Normal tracking: drift toward the cursor, ramping up with distance.
    let x = 0;
    let y = 0;
    if (dist > 0) {
      const ramp = Math.min(dist / this.rampDistance, 1);
      x = (dx / dist) * this.maxOffsetX * ramp;
      y = (dy / dist) * this.maxOffsetY * ramp;
    }

    if (cross > 0) {
      // When the cursor is close to / between the eyes, each pupil converges
      // inward toward the nose — as if the target were far away on the opposite
      // side — producing a cross-eyed look. The two pupil layers share a
      // bounding box, so the inward direction comes from their order: the first
      // pupil pulls one way, the second the other.
      const inwardSign = (index === 0 ? 1 : -1) * (this.crossInvert ? -1 : 1);
      const crossX = inwardSign * this.maxOffsetX;
      x = x * (1 - cross) + crossX * cross;
      y = y * (1 - cross);
    }

    this.offsets.set(el, { x, y });
    el.style.transform = `translate(${x}px, ${y}px)`;
  }
}
