import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { z } from 'zod';

import artJson from '../content/art.json';
import projectsJson from '../content/projects.json';

/**
 * Zod schemas = the single source of truth for the project contract. Unlike a
 * plain TS `interface` (erased at compile time), `.parse()` validates the shape
 * at runtime, so if the backend/Drive content ever drifts we fail loudly at the
 * boundary instead of rendering `undefined` deep in a template. The TS types are
 * inferred from the schemas, so they can never disagree with the validation.
 */
const LabeledItemSchema = z.object({
  title: z.string(),
  body: z.string(),
});

const ImageRefSchema = z.object({
  url: z.string(),
  name: z.string(),
  width: z.number().default(0),
  height: z.number().default(0),
});

const TimelineSchema = z.object({
  start_date: z.string(),
  end_date: z.string(),
});

export const ProjectSchema = z.object({
  slug: z.string(),
  name: z.string(),
  // Top-level Portfolio tab; `category` is the sub-group inside it. Both are
  // defaulted so content baked before sections existed still parses.
  section: z.string().default('Professional'),
  category: z.string(),
  featured: z.boolean().default(false),
  status: z.string(),
  status_label: z.string(),
  date_created: z.string(),
  timeline: TimelineSchema,
  duration: z.string(),
  stack: z.array(z.string()),
  link: z.string().default(''),
  description: z.string(),
  contributions: z.array(LabeledItemSchema),
  key_features: z.array(LabeledItemSchema),
  images: z.array(ImageRefSchema),
  image_url: z.string().nullable(),
  client: z.string().nullable(),
  notes: z.string(),
});

// Art images carry per-artwork metadata from the Art-work info.json.
const ArtImageSchema = z.object({
  url: z.string(),
  name: z.string(),
  width: z.number().default(0),
  height: z.number().default(0),
  title: z.string().default(''),
  size: z.number().default(2),
  medium: z.string().default(''),
  dimensions: z.string().default(''),
  start_date: z.string().default(''),
  end_date: z.string().default(''),
  description: z.string().default(''),
});

const ProjectListSchema = z.array(ProjectSchema);
const ArtImageListSchema = z.array(ArtImageSchema);

export type Project = z.infer<typeof ProjectSchema>;
export type LabeledItem = z.infer<typeof LabeledItemSchema>;
export type ImageRef = z.infer<typeof ImageRefSchema>;
export type ArtImage = z.infer<typeof ArtImageSchema>;

// Content is baked in at build time by scripts/export-content.mjs, which reads
// the Drive-backed FastAPI CMS running on localhost and writes src/content/*.
// Parsing happens once at module load: if a build ever bakes in malformed
// content, it fails loudly here rather than rendering `undefined` in a
// template. The same Zod contract the API version used still guards it.
const PROJECTS: Project[] = ProjectListSchema.parse(projectsJson);
const ART: ArtImage[] = ArtImageListSchema.parse(artJson);

/**
 * Serves the portfolio content baked into this build.
 *
 * The API surface is deliberately unchanged from the backend-backed version —
 * still Observables — so components work identically and this can be swapped
 * back to live HTTP calls without touching anything that consumes it.
 */
@Injectable({ providedIn: 'root' })
export class ProjectService {
  /** All projects, for the portfolio grid. */
  listProjects(): Observable<Project[]> {
    return of(PROJECTS);
  }

  /** A single project by slug, for the detail page. */
  getProject(slug: string): Observable<Project> {
    const project = PROJECTS.find((p) => p.slug === slug);
    // Mirrors the 404 the API returned, so the detail page's error path is
    // exercised the same way for an unknown slug.
    return project ? of(project) : throwError(() => new Error(`Unknown project: ${slug}`));
  }

  /** All Art-work images with metadata, for the Art page. */
  listArt(): Observable<ArtImage[]> {
    return of(ART);
  }
}
