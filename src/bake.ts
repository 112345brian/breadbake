import {
  App,
  FileSystemAdapter,
  Platform,
  TFile,
  parseLinktext,
  resolveSubpath,
} from 'obsidian';

import { BakeSettings } from './main';
import {
  applyIndent,
  extractSubpath,
  reindexNotes,
  removeTags,
  removeTasks,
  sanitizeBakedContent,
  stripFirstBullet,
} from './util';

const lineStartRE = /(?:^|\n) *$/;
const listLineStartRE = /(?:^|\n)([ \t]*)(?:[-*+]|[0-9]+[.)]) +$/;
const lineEndRE = /^ *(?:\r?\n|$)/;
// Matches a dangling ![[file#^ at the end of a string (partial block-embed reference)
const remainingEmbed = /!\[\[[\s\w]+?#\^$/;

function getContextHeadingLevel(textBefore: string): number {
  const matches = [...textBefore.matchAll(/^#{1,6}(?= )/gm)];
  return matches.length ? matches[matches.length - 1][0].length : 0;
}

function adjustHeadings(md: string, hostLevel: number): string {
  if (!hostLevel) return md;
  return md.replace(/^(#{1,6}) /gm, (_, hashes) => {
    const newLevel = Math.min(hashes.length + hostLevel, 6);
    return '#'.repeat(newLevel) + ' ';
  });
}

export async function bake(
  app: App,
  file: TFile,
  subpath: string | null,
  ancestors: Set<TFile>,
  settings: BakeSettings,
  footnoteCounter: { index: number } = { index: 1 }
) {
  const { vault, metadataCache } = app;

  let text = await vault.cachedRead(file);
  const cache = metadataCache.getFileCache(file);

  // No cache? Return the file as is...
  if (!cache) return text;

  // Get the target block or section if we have a subpath
  const resolvedSubpath = subpath ? resolveSubpath(cache, subpath) : null;
  if (resolvedSubpath) {
    text = extractSubpath(text, resolvedSubpath, cache);
  }

  const links = settings.bakeLinks ? cache.links || [] : [];
  const embeds = settings.bakeEmbeds ? cache.embeds || [] : [];
  const targets = [...links, ...embeds];

  // No links in the current file; we can stop here...
  if (targets.length === 0) return text;

  targets.sort((a, b) => a.position.start.offset - b.position.start.offset);

  const newAncestors = new Set(ancestors);
  newAncestors.add(file);

  // This helps us keep track of edits we make to the text and sync them with
  // position data held in the metadata cache
  let posOffset = 0;

  for (const target of targets) {
    const { path, subpath } = parseLinktext(target.link);
    const linkedFile = metadataCache.getFirstLinkpathDest(path, file.path);

    if (!linkedFile) continue;

    // Skip Excalidraw diagrams — they don't embed meaningfully as text
    if (
      settings.skipExcalidraw &&
      (linkedFile.extension === 'excalidraw' ||
        linkedFile.name.endsWith('.excalidraw.md'))
    )
      continue;

    const start = target.position.start.offset + posOffset;
    const end = target.position.end.offset + posOffset;
    const prevLen = end - start;

    // Handle dangling ![[file#^ partial block references that Obsidian's cache
    // can leave split across two link entries
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
    const isMarkdownFile = linkedFile.extension === 'md';

    const replaceTarget = (replacement: string) => {
      text = before + replacement + after;
      posOffset += replacement.length - prevLen;
    };

    if (!isMarkdownFile) {
      // Skip link processing if we're not converting file links...
      if (!settings.convertFileLinks) continue;

      const adapter = app.vault.adapter as FileSystemAdapter;

      // FYI: The mobile adapter also has getFullPath so this should work on mobile and desktop
      //      The mobile adapter isn't exported in the public API, however
      if (!adapter.getFullPath) continue;
      const fullPath = adapter.getFullPath(linkedFile.path);
      const protocol = Platform.isWin ? 'file:///' : 'file://';
      replaceTarget(`![](${protocol}${encodeURI(fullPath)})`);
      continue;
    }

    // Preserve inline [[links]] that have no display text (e.g. citation-style references)
    // rather than stripping their brackets
    if (settings.preserveInlineLinks && isInline && !target.displayText) {
      continue;
    }

    // Replace the link with its text if it's inline or would create an infinite loop
    if (newAncestors.has(linkedFile) || isInline) {
      replaceTarget(target.displayText || path);
      continue;
    }

    // Recurse and bake the linked file...
    let baked: string;
    try {
      baked = sanitizeBakedContent(
        reindexNotes(
          await bake(app, linkedFile, subpath, newAncestors, settings, footnoteCounter),
          () => String(footnoteCounter.index++)
        )
      );
    } catch (e) {
      throw new Error(`Error baking '${linkedFile.path}': ${(e as Error).message}`);
    }

    if (settings.adjustHeadingLevels) {
      baked = adjustHeadings(baked, getContextHeadingLevel(before));
    }

    replaceTarget(
      listMatch ? applyIndent(stripFirstBullet(baked), listMatch[1]) : baked
    );
  }

  if (settings.removeTasks) text = removeTasks(text);
  if (settings.removeTags) text = removeTags(text);

  return text;
}
