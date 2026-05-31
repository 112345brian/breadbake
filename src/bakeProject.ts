import { App, TFile } from 'obsidian';
import { BakeSettings } from './main';
import { bake } from './bake';
import { reindexNotes, sanitizeBakedContent } from './util';

export interface ProjectScene {
  file: TFile;
  order: number;
  hasOrder: boolean;
}

function getBakeMap(fm: Record<string, unknown>): Record<string, number> | null {
  const raw = fm['bake'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, number>;
}

export function getProjectScenes(app: App, projectName: string): ProjectScene[] {
  const scenes: ProjectScene[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;

    const bakeMap = getBakeMap(fm);
    if (!bakeMap || !(projectName in bakeMap)) continue;

    const rawOrder = bakeMap[projectName];
    const order = rawOrder != null ? Number(rawOrder) : Infinity;
    scenes.push({ file, order, hasOrder: rawOrder != null });
  }

  scenes.sort((a, b) => a.order - b.order);
  return scenes;
}

export function getKnownProjects(app: App): string[] {
  const projects = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const bakeMap = fm ? getBakeMap(fm) : null;
    if (bakeMap) Object.keys(bakeMap).forEach((p) => projects.add(p));
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
      if (!fm['bake'] || typeof fm['bake'] !== 'object' || Array.isArray(fm['bake'])) {
        fm['bake'] = {};
      }
      (fm['bake'] as Record<string, number>)[projectName] = i + 1;
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
