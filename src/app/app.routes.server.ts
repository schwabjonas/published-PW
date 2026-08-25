import { RenderMode, ServerRoute } from '@angular/ssr';

import projectsJson from '../content/projects.json';

/**
 * Every route is prerendered to plain HTML at build time — there is no server
 * at runtime, just files on GitHub Pages.
 *
 * `portfolio/:slug` is parameterised, so Angular cannot know which pages to
 * emit unless we enumerate them. The slugs come from the same baked content the
 * app renders from, so the two can never disagree.
 */
const slugs: string[] = (projectsJson as { slug: string }[]).map((p) => p.slug);

export const serverRoutes: ServerRoute[] = [
  {
    path: 'portfolio/:slug',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => slugs.map((slug) => ({ slug })),
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
