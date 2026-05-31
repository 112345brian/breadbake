/**
 * Frontmatter outline bake.
 *
 * Reads a nested YAML list from `bake-outline` in the root file's frontmatter
 * and assembles it into a BreadcrumbNode tree. Each item is either:
 *
 *   - "[[Note name]]"                       ← leaf
 *   - "[[Note name]]":                      ← node with children
 *     - "[[Child note]]"
 *
 * The nesting depth becomes the heading level shift (depth 1 → H2, etc.).
 * Reuses bakeBreadcrumbTree for the actual compilation.
 */

import { App, TFile } from 'obsidian';
import { BreadcrumbNode } from './breadcrumbs';

export const OUTLINE_FIELD = 'bake-outline';

function extractWikilink(str: string): string {
  const match = str.match(/\[\[([^\]|#]+)/);
  return match ? match[1].trim() : str.trim();
}

function resolveFile(app: App, name: string, sourceFile: TFile): TFile | null {
  return app.metadataCache.getFirstLinkpathDest(name, sourceFile.path) ?? null;
}

function parseItem(
  app: App,
  item: unknown,
  sourceFile: TFile,
  depth: number
): BreadcrumbNode | null {
  if (typeof item === 'string') {
    const file = resolveFile(app, extractWikilink(item), sourceFile);
    if (!file || file.extension !== 'md') return null;
    return { file, depth, children: [] };
  }

  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const keys = Object.keys(item as object);
    if (keys.length !== 1) return null;
    const key = keys[0];
    const file = resolveFile(app, extractWikilink(key), sourceFile);
    if (!file || file.extension !== 'md') return null;

    const rawChildren = (item as Record<string, unknown>)[key];
    const children = Array.isArray(rawChildren)
      ? rawChildren
          .map((c) => parseItem(app, c, sourceFile, depth + 1))
          .filter((n): n is BreadcrumbNode => n !== null)
      : [];

    return { file, depth, children };
  }

  return null;
}

/** Build a BreadcrumbNode tree from the `bake-outline` frontmatter key. */
export function buildOutlineTree(app: App, file: TFile): BreadcrumbNode | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const outline = fm?.[OUTLINE_FIELD];
  if (!Array.isArray(outline) || outline.length === 0) return null;

  const children = outline
    .map((item) => parseItem(app, item, file, 1))
    .filter((n): n is BreadcrumbNode => n !== null);

  if (children.length === 0) return null;
  return { file, depth: 0, children };
}

/** True if the file has a non-empty bake-outline in its frontmatter. */
export function hasOutline(app: App, file: TFile): boolean {
  const outline = app.metadataCache.getFileCache(file)?.frontmatter?.[OUTLINE_FIELD];
  return Array.isArray(outline) && outline.length > 0;
}
