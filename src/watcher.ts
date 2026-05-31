import { App, Notice, TFile } from 'obsidian';
import { onBCGraphUpdate } from './bcIntegration';
import { BakeSettings } from './main';
import { bake } from './bake';
import { bakeProject, getProjectScenes } from './bakeProject';
import { bakeBreadcrumbTree, buildBreadcrumbTree, flattenTree } from './breadcrumbs';
import { buildOutlineTree } from './outlineBake';
import { collectBakeTargets } from './ambiguity';
import { sanitizeBakedContent, reindexNotes, mergeTagsIntoFrontmatter } from './util';
import { exportImages } from './imageExport';
import { runAllValidations } from './validate';

export type WatchMode = 'link' | 'project' | 'breadcrumb' | 'outline';

export interface WatchConfig {
  outputPath: string;
  mode: WatchMode;
  rootFile?: TFile;        // link and breadcrumb modes
  projectName?: string;    // project mode
  settings: BakeSettings;
}

const DEBOUNCE_MS = 2000;

export class WatchManager {
  private watches = new Map<string, {
    config: WatchConfig;
    sourceFiles: Set<TFile>;
    timer: ReturnType<typeof setTimeout> | null;
    bcUnsubscribe: (() => void) | null;
  }>();

  private eventRef: ReturnType<App['vault']['on']>;

  constructor(private app: App) {
    this.eventRef = app.vault.on('modify', (file) => {
      if (!(file instanceof TFile)) return;
      this.onModify(file);
    });
  }

  add(config: WatchConfig, sourceFiles: Set<TFile>) {
    // For breadcrumb watches, also subscribe to BC graph updates
    let bcUnsubscribe: (() => void) | null = null;
    if (config.mode === 'breadcrumb') {
      bcUnsubscribe = onBCGraphUpdate(this.app, () => {
        this.scheduleRebake(config.outputPath);
      });
    }
    this.watches.set(config.outputPath, { config, sourceFiles, timer: null, bcUnsubscribe });
    new Notice(`👁 Watching ${config.outputPath}`);
  }

  remove(outputPath: string) {
    const w = this.watches.get(outputPath);
    if (w?.timer) clearTimeout(w.timer);
    w?.bcUnsubscribe?.();
    this.watches.delete(outputPath);
    new Notice(`Stopped watching ${outputPath}`);
  }

  removeAll() {
    for (const w of this.watches.values()) {
      if (w.timer) clearTimeout(w.timer);
      w.bcUnsubscribe?.();
    }
    this.watches.clear();
  }

  list(): string[] {
    return [...this.watches.keys()];
  }

  unload() {
    this.removeAll();
    this.app.vault.offref(this.eventRef);
  }

  private scheduleRebake(outputPath: string) {
    const watch = this.watches.get(outputPath);
    if (!watch) return;
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = setTimeout(() => this.rebake(outputPath), DEBOUNCE_MS);
  }

  private onModify(file: TFile) {
    for (const [outputPath, watch] of this.watches) {
      if (!watch.sourceFiles.has(file)) continue;
      this.scheduleRebake(outputPath);
    }
  }

  private async rebake(outputPath: string) {
    const watch = this.watches.get(outputPath);
    if (!watch) return;
    const { config } = watch;

    new Notice(`⟳ Rebaking ${outputPath}…`);

    try {
      let baked: string;
      let newSourceFiles: Set<TFile>;

      if (config.mode === 'link' && config.rootFile) {
        newSourceFiles = await collectBakeTargets(this.app, config.rootFile, new Set(), config.settings);
        baked = await bake(this.app, config.rootFile, null, new Set(), config.settings);

      } else if (config.mode === 'project' && config.projectName) {
        const scenes = getProjectScenes(this.app, config.projectName);
        newSourceFiles = new Set(scenes.map((s) => s.file));
        baked = await bakeProject(this.app, scenes, config.settings);

      } else if (config.mode === 'breadcrumb' && config.rootFile) {
        const tree = buildBreadcrumbTree(this.app, config.rootFile, new Set(), config.settings);
        newSourceFiles = new Set(flattenTree(tree).map((n) => n.file));
        baked = await bakeBreadcrumbTree(this.app, tree, config.settings);

      } else if (config.mode === 'outline' && config.rootFile) {
        const tree = buildOutlineTree(this.app, config.rootFile);
        if (!tree) return;
        newSourceFiles = new Set(flattenTree(tree).map((n) => n.file));
        baked = await bakeBreadcrumbTree(this.app, tree, config.settings);

      } else {
        return;
      }

      // Apply template injection
      baked = await applyTemplates(this.app, baked, config.settings);

      // Frontmatter merge
      if (config.settings.mergeFrontmatter) {
        const fields = config.settings.frontmatterMergeFields.split(',').map(f => f.trim()).filter(Boolean);
        for (const field of fields) {
          const tagSets = [...newSourceFiles].map(f => {
            const val = this.app.metadataCache.getFileCache(f)?.frontmatter?.[field];
            if (!val) return [];
            return Array.isArray(val) ? val.map(String) : [String(val)];
          });
          if (field === 'tags') baked = mergeTagsIntoFrontmatter(baked, tagSets);
        }
      }

      // Write output
      const { vault } = this.app;
      const existing = vault.getAbstractFileByPath(outputPath);
      if (existing instanceof TFile) {
        await vault.modify(existing, baked);
      } else {
        await vault.create(outputPath, baked);
      }

      // Update watched source files
      watch.sourceFiles = newSourceFiles;

      const warnings = runAllValidations(baked).filter(w => w.kind !== 'dataview-block' || config.settings.dataviewHandling === 'warn');
      if (warnings.length > 0) {
        new Notice(`⚠ ${outputPath} rebaked with ${warnings.length} warning(s). Check the file.`);
      } else {
        new Notice(`✓ ${outputPath} updated`);
      }
    } catch (e) {
      new Notice(`✗ Rebake failed: ${(e as Error).message}`);
    }
  }
}

export async function applyTemplates(
  app: App,
  text: string,
  settings: BakeSettings
): Promise<string> {
  let result = text;

  if (settings.headerTemplate) {
    const file = app.metadataCache.getFirstLinkpathDest(settings.headerTemplate, '');
    if (file) {
      const content = sanitizeBakedContent(await app.vault.cachedRead(file));
      result = content.trim() + '\n\n' + result;
    }
  }

  if (settings.footerTemplate) {
    const file = app.metadataCache.getFirstLinkpathDest(settings.footerTemplate, '');
    if (file) {
      const content = sanitizeBakedContent(await app.vault.cachedRead(file));
      result = result + '\n\n' + content.trim();
    }
  }

  return result;
}
