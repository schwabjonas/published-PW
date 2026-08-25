/**
 * Viseme lip-sync helpers.
 *
 * The TTS-Jonas server returns an ordered, non-overlapping timeline of
 * { viseme, start, end } (seconds), where `viseme` is one of the Oculus-style
 * 14-label set: sil, PP, FF, TH, DD, kk, CH, SS, RR, aa, E, I, O, U.
 * `sil` (and any unknown label) maps to the neutral/closed mouth.
 *
 * `VisemePlayer` replays the timeline against an <audio> element's clock so the
 * mouth stays locked to playback even if it stalls.
 */

export interface Viseme {
  viseme: string; // Oculus label
  start: number; // seconds from clip start
  end: number; // seconds from clip start
}

const TALKING_DIR = '/assets/icons/Animation/Talking/';

// Oculus viseme label → mouth PNG. `sil` is intentionally absent → neutral.
const VISEME_FILE: Record<string, string> = {
  PP: 'Mouth - B,M,P.png', // p / b / m — lips together
  FF: 'Mouth - F,V.png', // f / v — lip to teeth
  TH: 'Mouth - TH.png', // th
  DD: 'Mouth - C,D,G,K,N,S,T,X,Y,Z.png', // d / t / n
  kk: 'Mouth - C,D,G,K,N,S,T,X,Y,Z.png', // k / g
  CH: 'Mouth - CH,SH,J.png', // ch / sh / j
  SS: 'Mouth - C,D,G,K,N,S,T,X,Y,Z.png', // s / z
  RR: 'Mouth - R.png', // r
  aa: 'Mouth - A, E, I.png', // open "ah"
  E: 'Mouth - E.png', // "eh"
  I: 'Mouth - A, E, I.png', // "ih/ee"
  O: 'Mouth - O.png', // rounded "oh"
  U: 'Mouth - U.png', // rounded "oo"
};

/** Resolve a viseme label to its mouth image URL (null for sil/unknown). */
export function visemeSrc(label: string): string | null {
  const file = VISEME_FILE[label];
  // encodeURIComponent handles the spaces/commas in the filenames.
  return file ? TALKING_DIR + encodeURIComponent(file) : null;
}

/** Every mouth image URL — used to preload so frame swaps are instant. */
export function allVisemeSrcs(): string[] {
  return [...new Set(Object.values(VISEME_FILE))].map((f) => TALKING_DIR + encodeURIComponent(f));
}

/** Decode a base64 string into a typed audio Blob. */
export function base64ToBlob(b64: string, type = 'audio/wav'): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

/**
 * Drives a mouth image from a viseme timeline, synced to an audio element.
 * `setSrc` swaps the mouth; `restSrc` is shown for sil / gaps / paused / ended.
 */
export class VisemePlayer {
  private rafId: number | null = null;
  private index = 0;
  private lastSrc = '';

  constructor(private readonly setSrc: (src: string) => void) {}

  play(audioEl: HTMLMediaElement, visemes: Viseme[], restSrc: string): void {
    this.stop();
    this.index = 0;

    const apply = (label: string) => {
      const src = visemeSrc(label) ?? restSrc;
      if (src !== this.lastSrc) {
        this.lastSrc = src;
        this.setSrc(src);
      }
    };

    const tick = () => {
      if (audioEl.ended) {
        apply('sil'); // back to neutral when the clip finishes
        this.rafId = null;
        return;
      }
      const t = audioEl.currentTime;
      // Advance past frames that have already ended (currentTime is monotonic).
      while (this.index < visemes.length && visemes[this.index].end <= t) {
        this.index++;
      }
      const cur = visemes[this.index];
      // Active viseme only if currentTime falls within it; otherwise neutral.
      apply(!audioEl.paused && cur && t >= cur.start && t < cur.end ? cur.viseme : 'sil');
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastSrc = '';
  }
}
