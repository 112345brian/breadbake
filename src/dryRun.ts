import { App, TFile, parseLinktext } from 'obsidian';
import { BakeSettings } from './main';
import { passesFilter } from './util';

export interface DryRunEntry {
  file: TFile;
  depth: number;
  linkedBy: TFile | null;
}

export async function traceBake(
  app: App,
  file: TFile,
  ancestors: Set<TFile>,
  settings: BakeSettings,
  depth: number,
  linkedBy: TFile | null,
  results: DryRunEntry[]
): Promise<void> {
  results.push({ file, depth, linkedBy });

  // Don't recurse if we've hit the depth limit
  if (settings.maxDepth > 0 && depth >= settings.maxDepth) return;

  const { metadataCache } = app;
  const cache = metadataCache.getFileCache(file);
  if (!cache) return;

  const links = settings.bakeLinks ? cache.links || [] : [];
  const embeds = settings.bakeEmbeds ? cache.embeds || [] : [];
  const newAncestors = new Set(ancestors);
  newAncestors.add(file);

  for (const target of [...links, ...embeds]) {
    const { path } = parseLinktext(target.link);
    const linked = metadataCache.getFirstLinkpathDest(path, file.path);
    if (!linked || linked.extension !== 'md') continue;
    if (newAncestors.has(linked)) continue;
    if (settings.skipExcalidraw && linked.name.endsWith('.excalidraw.md')) continue;
    if (!passesFilter(linked.path, settings.includePattern, settings.excludePattern)) continue;
    await traceBake(app, linked, newAncestors, settings, depth + 1, file, results);
  }
}
