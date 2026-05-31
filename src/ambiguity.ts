import { App, TFile, parseLinktext } from 'obsidian';
import { passesFilter } from './util';
import { BakeSettings } from './main';

export type AmbiguityKind = 'no-heading' | 'empty-file';

export interface Ambiguity {
  kind: AmbiguityKind;
  file: TFile;
  suggestion: string | null;
}

export type Resolution =
  | { action: 'inject-heading'; title: string }
  | { action: 'skip' }
  | { action: 'include' };

export type ResolutionMap = Map<string, Resolution>;

function fileHasH1(app: App, file: TFile): boolean {
  const headings = app.metadataCache.getFileCache(file)?.headings;
  return headings?.some((h) => h.level === 1) ?? false;
}

function fileSuggestedTitle(app: App, file: TFile): string {
  return app.metadataCache.getFileCache(file)?.frontmatter?.title ?? file.basename;
}

export function detectAmbiguities(app: App, files: TFile[]): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];
  for (const file of files) {
    if (file.stat.size === 0) {
      ambiguities.push({ kind: 'empty-file', file, suggestion: null });
      continue;
    }
    if (!fileHasH1(app, file)) {
      ambiguities.push({
        kind: 'no-heading',
        file,
        suggestion: fileSuggestedTitle(app, file),
      });
    }
  }
  return ambiguities;
}

export function autoResolve(ambiguities: Ambiguity[]): ResolutionMap {
  const map: ResolutionMap = new Map();
  for (const a of ambiguities) {
    if (a.kind === 'empty-file') {
      map.set(a.file.path, { action: 'skip' });
    } else if (a.kind === 'no-heading') {
      map.set(a.file.path, { action: 'inject-heading', title: a.suggestion! });
    }
  }
  return map;
}

// Traverses the link graph of a file and returns every file that would be baked,
// without actually reading content. Used to scan for ambiguities before baking.
export async function collectBakeTargets(
  app: App,
  file: TFile,
  ancestors: Set<TFile>,
  settings: BakeSettings,
  currentDepth = 0
): Promise<Set<TFile>> {
  const { metadataCache } = app;
  const cache = metadataCache.getFileCache(file);
  if (!cache) return new Set();

  const links = settings.bakeLinks ? cache.links || [] : [];
  const embeds = settings.bakeEmbeds ? cache.embeds || [] : [];
  const newAncestors = new Set(ancestors);
  newAncestors.add(file);

  const targets = new Set<TFile>([file]);

  // Don't recurse further if we've hit the depth limit
  if (settings.maxDepth > 0 && currentDepth >= settings.maxDepth) return targets;

  for (const target of [...links, ...embeds]) {
    const { path } = parseLinktext(target.link);
    const linked = metadataCache.getFirstLinkpathDest(path, file.path);
    if (!linked || linked.extension !== 'md') continue;
    if (newAncestors.has(linked)) continue;
    if (settings.skipExcalidraw && linked.name.endsWith('.excalidraw.md')) continue;
    if (!passesFilter(linked.path, settings.includePattern, settings.excludePattern)) continue;
    targets.add(linked);
    const nested = await collectBakeTargets(app, linked, newAncestors, settings, currentDepth + 1);
    nested.forEach((f) => targets.add(f));
  }

  return targets;
}
