import { App, TFile, parseLinktext } from 'obsidian';
import { BakeSettings } from './main';
import { passesFilter } from './util';

export interface DryRunEntry {
  file: TFile;
  depth: number;
  linkedBy: TFile | null;
}

const lineStartRE = /(?:^|\n) *$/;
const listLineStartRE = /(?:^|\n)([ \t]*)(?:[-*+]|[0-9]+[.)]) +$/;
const lineEndRE = /^ *(?:\r?\n|$)/;
const remainingEmbed = /!\[\[[\s\w]+?#\^$/;

/**
 * Traces the bake graph accurately — reads each file's content and applies
 * the same isInline check as bake(), so only files that would actually be
 * expanded appear in the results (not inline links, which just become text).
 */
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

  if (settings.maxDepth > 0 && depth >= settings.maxDepth) return;

  const { metadataCache, vault } = app;
  const cache = metadataCache.getFileCache(file);
  if (!cache) return;

  const links = settings.bakeLinks ? cache.links || [] : [];
  const embeds = settings.bakeEmbeds ? cache.embeds || [] : [];
  const targets = [...links, ...embeds].sort(
    (a, b) => a.position.start.offset - b.position.start.offset
  );
  if (targets.length === 0) return;

  // Read actual content so we can check isInline — same as bake()
  const text = await vault.cachedRead(file);

  const newAncestors = new Set(ancestors);
  newAncestors.add(file);

  let posOffset = 0;

  for (const target of targets) {
    const { path } = parseLinktext(target.link);
    const linked = metadataCache.getFirstLinkpathDest(path, file.path);
    if (!linked || linked.extension !== 'md') continue;
    if (newAncestors.has(linked)) continue;
    if (settings.skipExcalidraw && linked.name.endsWith('.excalidraw.md')) continue;
    if (!passesFilter(linked.path, settings.includePattern, settings.excludePattern)) continue;

    const start = target.position.start.offset + posOffset;
    const end = target.position.end.offset + posOffset;

    let hasRemovedEmbed = false;
    const before = text.substring(0, start).replace(remainingEmbed, () => {
      hasRemovedEmbed = true;
      return '';
    });
    const after = hasRemovedEmbed
      ? text.substring(text.substring(0, end).lastIndexOf(']') + 1)
      : text.substring(end);

    const listMatch = settings.bakeInList ? before.match(listLineStartRE) : null;
    const isInline = !(listMatch || lineStartRE.test(before)) || !lineEndRE.test(after);

    // Skip inline links — they become display text in the output, not expanded content
    if (isInline) continue;

    // Preserve inline links without display text (citation-style) — same as bake()
    if (settings.preserveInlineLinks && isInline && !target.displayText) continue;

    // posOffset shifts as we track what the real bake would substitute
    // (we don't need the value, but keeping it lets us mirror bake() accurately)
    posOffset += 0; // placeholder — no content changes in dry run

    await traceBake(app, linked, newAncestors, settings, depth + 1, file, results);
  }
}
