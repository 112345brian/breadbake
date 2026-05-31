import { App, TFile } from 'obsidian';
import { BakeSettings } from './main';
import { bake } from './bake';
import { reindexNotes, sanitizeBakedContent } from './util';

export interface ProjectScene {
  file: TFile;
  order: number;
  hasOrder: boolean;
}

export function getProjectScenes(app: App, projectName: string): ProjectScene[] {
  const scenes: ProjectScene[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;

    const proj = fm['bake-project'];
    if (!proj || String(proj).trim() !== projectName.trim()) continue;

    const rawOrder = fm['bake-order'];
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
    const proj = fm?.['bake-project'];
    if (proj) projects.add(String(proj).trim());
  }
  return [...projects].sort();
}

export async function writeSceneOrders(
  app: App,
  scenes: ProjectScene[]
): Promise<void> {
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    await app.fileManager.processFrontMatter(scene.file, (fm) => {
      fm['bake-order'] = i + 1;
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
