import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Project, ProjectService } from './project.service';

interface CategoryGroup {
  /** Composite key, so two sections can both have a "Front End" group. */
  key: string;
  section: string;
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
   * Optional intro copy shown under a section tab. Keyed by section name. This
   * is where a tab gets reframed in one line — e.g. stopping "Academia" from
   * reading as "homework".
   */
  private readonly sectionDescriptions: Record<string, string> = {
    Academia:
      'Course projects where I built more than the assignment asked for.',
  };

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
   * Highlighted projects for the current tab. These render in their own block
   * above the category lists and are deliberately *excluded* from those lists
   * below, so a highlighted project never appears twice on the same page.
   */
  protected readonly highlights = computed<Project[]>(() =>
    this.visible().filter((p) => p.featured),
  );

  /**
   * Non-highlighted projects bucketed by category, preserving first-seen order.
   * Only categories that actually have projects appear.
   */
  protected readonly groups = computed<CategoryGroup[]>(() => {
    const groups: CategoryGroup[] = [];
    const byName = new Map<string, CategoryGroup>();
    for (const project of this.visible()) {
      if (project.featured) continue; // shown in the highlight block instead
      // Keyed by section *and* category: on the All tab an Academia "Front End"
      // project must not fall into the Professional "Front End" group.
      const key = `${project.section}|${project.category}`;
      let group = byName.get(key);
      if (!group) {
        group = { key, section: project.section, category: project.category, projects: [] };
        byName.set(key, group);
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

  /** Intro copy for a category, or null if none is defined. */
  protected description(category: string): string | null {
    return this.categoryDescriptions[category] ?? null;
  }

  /** Intro copy for the active section, or null if none is defined. */
  protected sectionDescription(): string | null {
    const section = this.activeSection();
    return section === null ? null : (this.sectionDescriptions[section] ?? null);
  }

  /**
   * Group header text. On a section tab the section is already established by
   * the tab, so only the category is shown; on "All" it is prefixed so a group
   * reads as "Professional · Front End" rather than a bare "Front End".
   */
  protected groupLabel(group: CategoryGroup): string {
    return this.activeSection() === null
      ? `${group.section} · ${group.category}`
      : group.category;
  }

  /**
   * Section and category for a single row. Highlighted projects are lifted out
   * of their category group, so without this they'd be the only rows on the
   * page carrying no taxonomy at all.
   */
  protected taxonomy(project: Project): string {
    return `${project.section} · ${project.category}`;
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
