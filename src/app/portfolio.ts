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
  private readonly categoryDescriptions: Record<string, string> = {};

  /**
   * Optional intro copy shown under a section tab. Keyed by section name. This
   * is where a tab gets reframed in one line — e.g. stopping "Academia" from
   * reading as "homework".
   */
  private readonly sectionDescriptions: Record<string, string> = {};

  // ── Section tabs (top level: Academia / Professional / Personal) ────────
  /** Active section tab, or null for the "All" default. */
  protected readonly activeSection = signal<string | null>(null);

  /**
   * Tabs in a fixed order so they don't reshuffle as content is added, with any
   * unrecognised section appended after the known three.
   */
  private readonly sectionOrder = ['Academia', 'Professional', 'Personal'];

  protected readonly sections = computed<string[]>(() => {
    const present = new Set(this.items().map((p) => p.section));
    const known = this.sectionOrder.filter((s) => present.has(s));
    const rest = [...present].filter((s) => !this.sectionOrder.includes(s));
    return [...known, ...rest];
  });

  /** Projects in the active section (all of them when no tab is selected). */
  private readonly visible = computed<Project[]>(() => {
    const section = this.activeSection();
    const items = this.items();
    return section === null ? items : items.filter((p) => p.section === section);
  });

  /** Count shown on the right of the tab bar. */
  protected readonly visibleCount = computed(() => this.visible().length);

  /**
   * Projects bucketed by category, preserving first-seen order. Only categories
   * that actually have projects appear.
   *
   * The two taxonomies are deliberately independent: the tabs above filter by
   * `section` (who the work was for), these bars group by `category` (the kind
   * of engineering). So on "All" a category spans every section.
   *
   * `featured` is still carried on each project but no longer changes rendering
   * — the highlight block was removed. Reinstating it means filtering on it
   * here again.
   */
  protected readonly groups = computed<CategoryGroup[]>(() => {
    const groups: CategoryGroup[] = [];
    const byName = new Map<string, CategoryGroup>();
    for (const project of this.visible()) {
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

  /** Switch tabs (null = All). */
  protected setSection(section: string | null): void {
    this.activeSection.set(section);
  }

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

  /**
   * A defined, non-blank intro string, or null. Both lookups go through this so
   * an entry left empty — or holding only spaces, which is truthy and would
   * otherwise render an empty intro bar — is treated the same as no entry.
   */
  private static intro(value: string | undefined): string | null {
    const text = value?.trim();
    return text ? text : null;
  }

  /** Intro copy for a category, or null if none is defined. */
  protected description(category: string): string | null {
    return Portfolio.intro(this.categoryDescriptions[category]);
  }

  /** Intro copy for the active section, or null if none is defined. */
  protected sectionDescription(): string | null {
    const section = this.activeSection();
    return section === null ? null : Portfolio.intro(this.sectionDescriptions[section]);
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
