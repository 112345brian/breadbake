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
  convertWikilinksToMarkdown,
  ensureHeading,
  extractSubpath,
  isEffectivelyEmpty,
  passesFilter,
  reindexNotes,
  removeTags,
  removeTasks,
  sanitizeBakedContent,
  stripComments,
  stripDataviewBlocks,
  stripFirstBullet,
} from './util';
import { ResolutionMap } from './ambiguity';

function resolveFileSettings(
  app: App,
  file: TFile,
  globalSettings: BakeSettings
): BakeSettings {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const overrides = fm?.['bake-settings'];
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return globalSettings;
  }
  return { ...globalSettings, ...(overrides as Partial<BakeSettings>) };
}

const lineStartRE = /(?:^|\n) *$/;
const listLineStartRE = /(?:^|\n)([ \t]*)(?:[-*+]|[0-9]+[.)]) +$/;
const lineEndRE = /^ *(?:\r?\n|$)/;
// Matches a dangling ![[file#^ at the end of a string (partial block-embed reference)
const remainingEmbed = /!\[\[[\s\w]+?#\^$/;

function getContextHeadingLevel(textBefore: string): number {
  const matches = [...textBefore.matchAll(/^#{1,6}(?= )/gm)];
  return matches.length ? matches[matches.length - 1][0].length : 0;
}

function adjustHeadings(md: string, shift: number): string {
  if (!shift) return md;
  return md.replace(/^(#{1,6}) /gm, (_, hashes) => {
    const newLevel = Math.min(hashes.length + shift, 6);
    return '#'.repeat(newLevel) + ' ';
  });
}

// Converts leading whitespace to an indentation depth (tabs = 1 level, every 2 spaces = 1 level)
function indentDepth(indent: string): number {
  const tabs = (indent.match(/\t/g) || []).length;
  const spaces = indent.length - tabs;
  return tabs + Math.floor(spaces / 2);
}

export async function bake(
  app: App,
  file: TFile,
  subpath: string | null,
  ancestors: Set<TFile>,
  settings: BakeSettings,
  footnoteCounter: { index: number } = { index: 1 },
  resolutions?: ResolutionMap,
  currentDepth = 0
) {
  const { vault, metadataCache } = app;

  // Per-file settings override globals for this file's own content only.
  // Recursive calls still use the original settings.
  const effectiveSettings = resolveFileSettings(app, file, settings);

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

    // Depth limit: treat as plain text once we've hit the max
    if (effectiveSettings.maxDepth > 0 && currentDepth >= effectiveSettings.maxDepth) {
      replaceTarget(target.displayText || path);
      continue;
    }

    // Pattern filters: treat as plain text if the linked file is out of scope
    if (!passesFilter(linkedFile.path, effectiveSettings.includePattern, effectiveSettings.excludePattern)) {
      replaceTarget(target.displayText || path);
      continue;
    }

    // Recurse and bake the linked file...
    // Check pre-computed resolution (from interactive or auto structured mode)
    const resolution = resolutions?.get(linkedFile.path);
    if (resolution?.action === 'skip') {
      replaceTarget('');
      continue;
    }

    let baked: string;
    try {
      baked = sanitizeBakedContent(
        reindexNotes(
          await bake(app, linkedFile, subpath, newAncestors, settings, footnoteCounter, resolutions, currentDepth + 1),
          () => String(footnoteCounter.index++)
        )
      );
    } catch (e) {
      throw new Error(`Error baking '${linkedFile.path}': ${(e as Error).message}`);
    }

    if (resolution?.action === 'inject-heading') {
      baked = ensureHeading(baked, resolution.title);
    } else if (settings.structuredMode) {
      if (isEffectivelyEmpty(baked)) { replaceTarget(''); continue; }
      const title =
        app.metadataCache.getFileCache(linkedFile)?.frontmatter?.title ||
        linkedFile.basename;
      baked = ensureHeading(baked, title);
    }

    if (settings.mocMode && listMatch) {
      // MOC mode: treat bullet indentation as document outline depth.
      // Shift all headings in the linked file so they nest at the right level,
      // then inject a heading if the file had none.
      const depth = indentDepth(listMatch[1]);
      const shift = 1 + depth; // depth 0 → H1 becomes H2, depth 1 → H1 becomes H3, …
      baked = adjustHeadings(baked, shift);
      const hasH1 = app.metadataCache.getFileCache(linkedFile)?.headings?.some(
        (h) => h.level === 1
      );
      if (!hasH1) {
        const title =
          target.displayText ||
          app.metadataCache.getFileCache(linkedFile)?.frontmatter?.title ||
          linkedFile.basename;
        baked = `${'#'.repeat(2 + depth)} ${title}\n\n${baked}`;
      }
      replaceTarget(baked);
    } else {
      if (settings.adjustHeadingLevels) {
        baked = adjustHeadings(baked, getContextHeadingLevel(before));
      }
      replaceTarget(listMatch ? applyIndent(stripFirstBullet(baked), listMatch[1]) : baked);
    }
  }

  // Strip the dangling bullet markers left in front of headings after MOC expansion.
  // e.g. "* ## Chapter 1" → "## Chapter 1"
  if (effectiveSettings.mocMode) {
    text = text.replace(/^[ \t]*[-*+] +(#{1,6} )/gm, '$1');
  }

  if (effectiveSettings.removeTasks) text = removeTasks(text);
  if (effectiveSettings.removeTags) text = removeTags(text);
  if (effectiveSettings.stripComments) text = stripComments(text);
  if (effectiveSettings.dataviewHandling === 'strip') text = stripDataviewBlocks(text);
  if (effectiveSettings.convertWikilinks) text = convertWikilinksToMarkdown(text);

  return text;
}
