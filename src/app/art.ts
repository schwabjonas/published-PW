import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { ArtImage, ProjectService } from './project.service';

/** An artwork placed at an absolute position in the masonry. */
interface PlacedArt extends ArtImage {
  index: number; // position in the (shuffled) images list, for the lightbox
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Masonry {
  items: PlacedArt[];
  height: number;
  /** Tallest − shortest column bottom: the ragged gap above the footer. */
  bottomFill: number;
}

// Each artwork spans a whole number of columns based on its size (size 1 is the
// largest): size 1 = 3 columns, size 2 = 2 columns, size 3 = 1 column.
const SIZE_COLUMNS: Record<number, number> = { 1: 3, 2: 2, 3: 1 };

// Mediums that still tag/show their artworks but are hidden from the filter bar.
const HIDDEN_FILTER_MEDIUMS = new Set<string>(['Drawing']);

/** The filter category for a medium — just its first word, so "Mixed Media" and
 *  "Mixed media on paper" both group under "Mixed". The full string is still
 *  shown in the detail window. */
function mediumCategory(medium: string): string {
  return medium.trim().split(/\s+/)[0] ?? '';
}

// Fixed seed so the "random" order is stable across reloads and identical on the
// server and client (no hydration mismatch / reshuffle-on-resize jumping).
const SHUFFLE_SEED = 0x5f3759df;

/** Small, fast seeded PRNG (mulberry32) for a deterministic shuffle. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

@Component({
  selector: 'app-art',
  imports: [],
  templateUrl: './art.html',
})
export class Art {
  private readonly projects = inject(ProjectService);

  // Art images (shuffled, with size metadata + pixel dimensions) from the CMS.
  protected readonly images = signal<ArtImage[]>([]);
  // Measured width of the gallery container; drives the layout on resize.
  protected readonly containerWidth = signal(1200);

  private readonly grid = viewChild<ElementRef<HTMLElement>>('grid');

  // Base column width — the column COUNT is derived from the live page width
  // (~12 columns at 1200px), so it adapts to screen size at runtime.
  private readonly baseColumnWidth = 100;

  /**
   * Column masonry via a skyline + best-fit packer (the standard approach for
   * 2-D strip packing — see Jylänki, "A Thousand Ways to Pack the Bin"). Each
   * artwork spans whole columns from its `size` (3/2/1), height from its true
   * aspect ratio (whole image shown). Recomputes on data/width change.
   */
  // ── Filter bar (categories derived from the `medium` field) ────────────
  /** Active medium filter, or null for the "All" default. */
  protected readonly activeMedium = signal<string | null>(null);

  /** Distinct medium categories (first word of each medium), first-seen order. */
  protected readonly filters = computed<string[]>(() => {
    const seen = new Set<string>();
    for (const img of this.images()) {
      const category = mediumCategory(img.medium);
      if (category && !HIDDEN_FILTER_MEDIUMS.has(category)) seen.add(category);
    }
    return [...seen];
  });

  /** Images whose medium category matches the active filter (all when none). */
  protected readonly filtered = computed<ArtImage[]>(() => {
    const medium = this.activeMedium();
    const imgs = this.images();
    return medium === null ? imgs : imgs.filter((img) => mediumCategory(img.medium) === medium);
  });

  protected readonly masonry = computed<Masonry>(() =>
    this.buildMasonry(this.filtered(), this.containerWidth()),
  );

  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly doc = inject(DOCUMENT);

  constructor() {
    // Lock background scroll while the overlay is open.
    effect(() => {
      this.doc.body.style.overflow = this.selectedIndex() !== null ? 'hidden' : '';
    });

    this.projects.listArt().subscribe({
      // Shuffle once (seeded) so sizes are interspersed instead of grouped.
      next: (images) => this.images.set(seededShuffle(images, SHUFFLE_SEED)),
      error: () => this.images.set([]),
    });

    // Measure the container and re-pack on resize (column count follows the
    // current page width at runtime).
    afterNextRender(() => {
      const el = this.grid()?.nativeElement;
      if (!el) return;
      this.measureGrid(); // initial pack at the real width
      const observer = new ResizeObserver(() => {
        // Zone.js doesn't patch ResizeObserver, so this callback runs outside
        // Angular — run the update in the zone so change detection repaints.
        this.zone.run(() => this.measureGrid());
      });
      observer.observe(el);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /**
   * Re-measure the gallery width and re-pack. Shared by the ResizeObserver and
   * the window:resize listener so the layout always tracks the viewport — the
   * observer can miss viewport changes that don't resize the grid's own box
   * (e.g. closing docked devtools), which the resize event still catches.
   */
  private measureGrid(): void {
    const width = this.grid()?.nativeElement.clientWidth ?? 0;
    if (width > 0) this.containerWidth.set(width);
  }

  /** Re-pack on any viewport resize. Fires inside the Angular zone, so the
   *  signal update repaints without an explicit zone.run. */
  @HostListener('window:resize')
  protected onResize(): void {
    this.measureGrid();
  }

  // ── Lightbox / detail overlay ──────────────────────────────────────────
  /** Index of the open artwork in images(), or null when the overlay is closed. */
  protected readonly selectedIndex = signal<number | null>(null);

  protected readonly selected = computed<ArtImage | null>(() => {
    const i = this.selectedIndex();
    const imgs = this.filtered();
    return i === null ? null : (imgs[i] ?? null);
  });

  /** Switch the active medium filter and close any open lightbox (its index
   *  refers to the previously filtered list, which is about to change). */
  protected setFilter(medium: string | null): void {
    this.activeMedium.set(medium);
    this.selectedIndex.set(null);
  }

  /** 1-based position of the open artwork, for the "02 / 08" counter. */
  protected readonly position = computed<number>(() => (this.selectedIndex() ?? 0) + 1);

  protected readonly prevArt = computed<ArtImage | null>(() => this.neighbor(-1));
  protected readonly nextArt = computed<ArtImage | null>(() => this.neighbor(1));

  /** "Mixed media · 18 × 24 in" — medium (or "Unknown") plus dimensions when set. */
  protected readonly currentMeta = computed<string>(() => {
    const art = this.selected();
    if (!art) return '';
    return [this.orUnknown(art.medium), art.dimensions?.trim()].filter((s) => s).join(' · ');
  });

  private neighbor(delta: number): ArtImage | null {
    const i = this.selectedIndex();
    const imgs = this.filtered();
    if (i === null || !imgs.length) return null;
    return imgs[(i + delta + imgs.length) % imgs.length];
  }

  protected open(index: number): void {
    this.selectedIndex.set(index);
  }

  protected close(): void {
    this.selectedIndex.set(null);
  }

  protected step(delta: number): void {
    const i = this.selectedIndex();
    const n = this.filtered().length;
    if (i === null || !n) return;
    this.selectedIndex.set((i + delta + n) % n);
  }

  /** Zero-padded counter, e.g. "02". */
  protected pad(n: number): string {
    return n.toString().padStart(2, '0');
  }

  /** ISO date -> "Jan 2024" (returns the raw value if it isn't parseable). */
  protected formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  /** A trimmed field value, or "Unknown" when it's blank — so the detail panel
   *  always shows a labelled value instead of dropping the row. */
  protected orUnknown(value: string | null | undefined): string {
    const v = value?.trim();
    return v ? v : 'Unknown';
  }

  /** Formatted date, or "Unknown" when the field is blank. */
  protected displayDate(iso: string | null | undefined): string {
    const v = iso?.trim();
    return v ? this.formatDate(v) : 'Unknown';
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (this.selectedIndex() === null) return;
    if (event.key === 'Escape') this.close();
    else if (event.key === 'ArrowLeft') this.step(-1);
    else if (event.key === 'ArrowRight') this.step(1);
  }

  private aspect(img: ArtImage): number {
    return img.width > 0 && img.height > 0 ? img.width / img.height : 1;
  }

  /**
   * Skyline best-fit strip packing.
   *
   * The skyline is `top[c]` — the current bottom edge of each column. Each step:
   *   1. find the lowest point of the skyline and its flat run of columns,
   *   2. drop in the widest remaining item that fits that run (so it rests
   *      FLUSH, creating no gap beneath it),
   *   3. if nothing fits the run (only happens once the 1-wide fillers run out),
   *      fall back to the item's bottom-left-fit position.
   * Since size-3 pieces are 1 column wide and plentiful, they fill narrow gaps,
   * keeping the layout tight. O(n²) worst case — trivial for a gallery.
   */
  private buildMasonry(images: ArtImage[], containerWidth: number): Masonry {
    if (!images.length || containerWidth <= 0) return { items: [], height: 0, bottomFill: 0 };

    const columns = Math.max(1, Math.round(containerWidth / this.baseColumnWidth));
    const columnWidth = containerWidth / columns;
    const top = new Array<number>(columns).fill(0);
    const EPS = 0.5;

    const pool = images.map((img, index) => {
      const span = Math.min(SIZE_COLUMNS[img.size] ?? 1, columns);
      return { img, index, span, height: (span * columnWidth) / this.aspect(img) };
    });
    type Entry = (typeof pool)[number];

    // Balancing layer (Longest-Processing-Time): place the tallest pieces first
    // so the shorter ones fill in last and level the columns — this minimises
    // the gap between the shortest and tallest column (a flat-ish bottom edge).
    pool.sort((a, b) => b.height - a.height);

    const items: PlacedArt[] = [];

    const place = (entry: Entry, start: number, restTop: number) => {
      const { img, index, span, height } = entry;
      const width = span * columnWidth;
      items.push({ ...img, index, left: start * columnWidth, top: restTop, width, height });
      for (let c = start; c < start + span; c++) top[c] = restTop + height;
    };

    while (pool.length) {
      // 1) Lowest point of the skyline.
      let minTop = Infinity;
      for (let c = 0; c < columns; c++) if (top[c] < minTop) minTop = top[c];

      // 2) Leftmost flat run of columns at that level.
      let start = 0;
      while (start < columns && top[start] > minTop + EPS) start++;
      let runEnd = start;
      while (runEnd < columns && top[runEnd] <= minTop + EPS) runEnd++;
      const runWidth = runEnd - start;

      // 3) Best fit: widest remaining item that fits the run (first in the
      //    shuffled pool on a tie -> preserves the random look).
      let pick = -1;
      let pickSpan = 0;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i].span;
        if (s <= runWidth && s > pickSpan) {
          pickSpan = s;
          pick = i;
          if (s === runWidth) break; // perfect fill
        }
      }

      if (pick >= 0) {
        const entry = pool.splice(pick, 1)[0];
        place(entry, start, minTop); // flush on the flat run -> no gap
        continue;
      }

      // 4) Nothing fits the narrow run: place the smallest-span remaining item
      //    at its lowest (bottom-left-fit) position, minimising the step.
      let mi = 0;
      for (let i = 1; i < pool.length; i++) if (pool[i].span < pool[mi].span) mi = i;
      const entry = pool.splice(mi, 1)[0];
      const span = entry.span;
      let bestStart = 0;
      let bestTop = Infinity;
      for (let st = 0; st <= columns - span; st++) {
        let windowTop = 0;
        for (let c = st; c < st + span; c++) if (top[c] > windowTop) windowTop = top[c];
        if (windowTop < bestTop) {
          bestTop = windowTop;
          bestStart = st;
        }
      }
      place(entry, bestStart, bestTop);
    }

    const maxTop = Math.max(...top);
    const minTop = Math.min(...top);
    return { items, height: maxTop, bottomFill: maxTop - minTop };
  }
}
