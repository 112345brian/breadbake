import { App, TFile } from 'obsidian';
import { BakeSettings } from './main';
import { bake } from './bake';
import { reindexNotes, sanitizeBakedContent } from './util';

export interface ProjectScene {
  file: TFile;
  order: number;
  hasOrder: boolean;
}

// Returns the order for a given project from either format, or null if not a member.
function resolveOrder(
  fm: Record<string, unknown>,
  projectName: string
): { order: number | null; format: 'map' | 'flat' } | null {
  // Map format: bake: { "project-name": 3 }
  const bakeVal = fm['bake'];
  if (bakeVal && typeof bakeVal === 'object' && !Array.isArray(bakeVal)) {
    const map = bakeVal as Record<string, unknown>;
    if (!(projectName in map)) return null;
    const raw = map[projectName];
    return { order: raw != null ? Number(raw) : null, format: 'map' };
  }

  // Flat format: bake-project: "project-name" + bake-order: 3
  const proj = fm['bake-project'];
  if (proj == null || String(proj).trim() !== projectName.trim()) return null;
  const raw = fm['bake-order'];
  return { order: raw != null ? Number(raw) : null, format: 'flat' };
}

export function getProjectScenes(app: App, projectName: string): ProjectScene[] {
  const scenes: ProjectScene[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;

    const resolved = resolveOrder(fm, projectName);
    if (!resolved) continue;

    const order = resolved.order ?? Infinity;
    scenes.push({ file, order, hasOrder: resolved.order != null });
  }

  scenes.sort((a, b) => a.order - b.order);
  return scenes;
}

export function getKnownProjects(app: App): string[] {
  const projects = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;

    const bakeVal = fm['bake'];
    if (bakeVal && typeof bakeVal === 'object' && !Array.isArray(bakeVal)) {
      Object.keys(bakeVal as object).forEach((p) => projects.add(p));
    } else if (fm['bake-project']) {
      projects.add(String(fm['bake-project']).trim());
    }
  }
  return [...projects].sort();
}

export async function writeSceneOrders(
  app: App,
  projectName: string,
  scenes: ProjectScene[]
): Promise<void> {
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    await app.fileManager.processFrontMatter(scene.file, (fm) => {
      const bakeVal = fm['bake'];
      if (bakeVal && typeof bakeVal === 'object' && !Array.isArray(bakeVal)) {
        // Already map format — update just this project's key
        (bakeVal as Record<string, number>)[projectName] = i + 1;
      } else {
        // Flat format — write back flat
        fm['bake-order'] = i + 1;
      }
    });
    scene.order = i + 1;
    scene.hasOrder = true;
  }
}

export async function bakeProject(
  app: App,
  scenes: ProjectScene[],
  settings: BakeSettings
): Promise<string> {
  // Seed ancestors with all project files so they are never inlined into each other
  const projectFiles = new Set<TFile>(scenes.map((s) => s.file));
  const footnoteCounter = { index: 1 };
  const parts: string[] = [];

  for (const scene of scenes) {
    let baked: string;
    try {
      baked = sanitizeBakedContent(
        reindexNotes(
          await bake(app, scene.file, null, new Set(projectFiles), settings, footnoteCounter),
          () => String(footnoteCounter.index++)
        )
      );
    } catch (e) {
      throw new Error(`Error baking scene '${scene.file.path}': ${(e as Error).message}`);
    }
    parts.push(baked);
  }

  return parts.join('\n\n');
}
