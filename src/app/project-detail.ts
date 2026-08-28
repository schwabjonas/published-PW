import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ImageRef, Project, ProjectService } from './project.service';

/**
 * Portfolio project detail page (route: /portfolio/:slug).
 *
 * Loads one project from the Drive-backed CMS and renders the case-study layout.
 * State is exposed as signals so the template stays declarative and the loading
 * / error / not-found branches are explicit.
 */
@Component({
  selector: 'app-project-detail',
  imports: [RouterLink],
  templateUrl: './project-detail.html',
})
export class ProjectDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly projects = inject(ProjectService);

  protected readonly project = signal<Project | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly failed = signal(false);

  /** Year shown in the footer meta — the project's end year. */
  protected readonly year = computed(() => {
    const p = this.project();
    return p?.timeline.end_date?.slice(0, 4) ?? '';
  });

  /** Bare hostname of the live link, e.g. "siemens.eu.thoughtindustries.com". */
  protected readonly host = computed(() => {
    const link = this.project()?.link;
    if (!link) return '';
    try {
      return new URL(link).hostname;
    } catch {
      return '';
    }
  });

  /**
   * True for images far taller than they are wide — annotated spec sheets and
   * the like. Squeezing one into a grid cell renders it as an unreadable
   * ribbon, so these get a capped, scrollable cell instead. Guarded on width so
   * a missing dimension (0) never trips the branch.
   */
  protected isTall(img: ImageRef): boolean {
    return img.width > 0 && img.height / img.width > 3;
  }

  constructor() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }
    this.projects.getProject(slug).subscribe({
      next: (project) => {
        this.project.set(project);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        // 404 -> unknown slug; anything else -> a real fetch/validation failure.
        if (err?.status === 404) this.notFound.set(true);
        else this.failed.set(true);
      },
    });
  }
}
