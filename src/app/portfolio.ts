import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Project, ProjectService } from './project.service';

interface CategoryGroup {
  category: string;
  projects: Project[];
}

@Component({
  selector: 'app-portfolio',
  imports: [RouterLink],
  templateUrl: './portfolio.html',
})
export class Portfolio {
  private readonly projects = inject(ProjectService);

  protected readonly items = signal<Project[]>([]);
  protected readonly loaded = signal(false);

  /**
   * Optional intro copy shown under a category header. Keyed by category name
   * (matches the `category` field in each project's info.json). Add entries here
   * as new categories appear.
   */
  private readonly categoryDescriptions: Record<string, string> = {
    // Hidden for now — uncomment to show the Front End category description.
    // 'Front End':
    //   'I love bringing designs to life with interactive and accessible user interfaces. From crafting animations that enhance the user experience to ensuring cross-browser compatibility, I focus on making the web a delightful place to navigate.',
  };

  /**
   * Projects bucketed by category, preserving first-seen order. Only categories
   * that actually have projects appear, so with everything defaulting to
   * "Front End" there's a single Front End section for now.
   */
  protected readonly groups = computed<CategoryGroup[]>(() => {
    const groups: CategoryGroup[] = [];
    const byName = new Map<string, CategoryGroup>();
    for (const project of this.items()) {
      let group = byName.get(project.category);
      if (!group) {
        group = { category: project.category, projects: [] };
        byName.set(project.category, group);
        groups.push(group);
      }
      group.projects.push(project);
    }
    return groups;
  });

  constructor() {
    // Content comes from the Drive-backed CMS (GET /api/v1/projects).
    this.projects.listProjects().subscribe({
      next: (projects) => {
        this.items.set(projects);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  /** Intro copy for a category, or null if none is defined. */
  protected description(category: string): string | null {
    return this.categoryDescriptions[category] ?? null;
  }

  /** Zero-padded position, e.g. "01". */
  protected number(index: number): string {
    return (index + 1).toString().padStart(2, '0');
  }

  /** Display year from the creation date. */
  protected year(project: Project): string {
    return project.date_created?.slice(0, 4) ?? '';
  }
}
