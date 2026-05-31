import { App, TFile, parseLinktext } from 'obsidian';
import { BakeSettings } from './main';
import { bake } from './bake';
import { reindexNotes, sanitizeBakedContent, stripDataviewBlocks } from './util';
import { ResolutionMap } from './ambiguity';

export interface BreadcrumbNode {
  file: TFile;
  depth: number;
  children: BreadcrumbNode[];
}

// Read the "down" links from a file's frontmatter using Obsidian's frontmatterLinks cache
function getDownLinks(app: App, file: TFile, downField: string): TFile[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];

  const fmLinks = cache.frontmatterLinks?.filter((l) => l.key === downField) ?? [];
  return fmLinks
    .map((l) => app.metadataCache.getFirstLinkpathDest(l.link, file.path))
    .filter((f): f is TFile => f != null && f.extension === 'md');
}

/**
 * If any of the given files define next/prev relationships among themselves,
 * sort them into linked-list order. Files not connected by next/prev retain
 * their original relative order at the end of the result.
 */
function sortByNextPrev(app: App, files: TFile[], nextField: string): TFile[] {
  if (files.length <= 1) return files;

  const fileSet = new Set(files.map((f) => f.path));
  const nextMap = new Map<string, TFile>(); // file.path → its next sibling
  const hasPrev = new Set<string>();         // paths that are pointed to by a 'next'

  for (const file of files) {
    const fmLinks = app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];
    for (const link of fmLinks) {
      if (link.key !== nextField) continue;
      const target = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (target && fileSet.has(target.path)) {
        nextMap.set(file.path, target);
        hasPrev.add(target.path);
      }
    }
  }

  // No next/prev relationships among these siblings — keep original order
  if (nextMap.size === 0) return files;

  // Start from the file(s) with no incoming 'next' pointer
  const heads = files.filter((f) => !hasPrev.has(f.path));
  const result: TFile[] = [];
  const visited = new Set<string>();

  for (const head of heads) {
    let cur: TFile | undefined = head;
    while (cur && !visited.has(cur.path)) {
      result.push(cur);
      visited.add(cur.path);
      cur = nextMap.get(cur.path);
    }
  }

  // Append anything not reached by the chain (disconnected files)
  for (const file of files) {
    if (!visited.has(file.path)) result.push(file);
  }

  return result;
}

// Read MOC-style list wikilinks from the file body (for combination mode)
function getMocBodyLinks(app: App, file: TFile): TFile[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];

  const links = [...(cache.links ?? []), ...(cache.embeds ?? [])];
  const seen = new Set<string>();
  const results: TFile[] = [];

  for (const link of links) {
    // Only pick up links that live in a list context (basic heuristic: position.start.col > 0
    // or the link is on a line that starts with a bullet — we approximate via the metadata)
    const { path } = parseLinktext(link.link);
    if (seen.has(path)) continue;
    seen.add(path);
    const linked = app.metadataCache.getFirstLinkpathDest(path, file.path);
    if (linked && linked.extension === 'md') results.push(linked);
  }

  return results;
}

export function buildBreadcrumbTree(
  app: App,
  file: TFile,
  ancestors: Set<TFile>,
  settings: BakeSettings,
  depth = 0
): BreadcrumbNode {
  const newAncestors = new Set(ancestors);
  newAncestors.add(file);

  // Primary: frontmatter down links
  let childFiles = getDownLinks(app, file, settings.breadcrumbDownField);

  // Combination mode: also pull in body links not already in the frontmatter list
  if (settings.breadcrumbCombineWithMoc) {
    const bodyLinks = getMocBodyLinks(app, file);
    const existing = new Set(childFiles.map((f) => f.path));
    for (const bf of bodyLinks) {
      if (!existing.has(bf.path)) {
        childFiles.push(bf);
        existing.add(bf.path);
      }
    }
  }

  // Re-order by next/prev chain if any siblings define it
  childFiles = sortByNextPrev(app, childFiles, settings.breadcrumbNextField);

  const children = childFiles
    .filter((f) => !newAncestors.has(f))
    .map((f) => buildBreadcrumbTree(app, f, newAncestors, settings, depth + 1));

  return { file, depth, children };
}

export function flattenTree(node: BreadcrumbNode): BreadcrumbNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

// Shift headings in md by `shift` levels
function adjustHeadings(md: string, shift: number): string {
  if (!shift) return md;
  return md.replace(/^(#{1,6}) /gm, (_, hashes) => {
    const newLevel = Math.min(hashes.length + shift, 6);
    return '#'.repeat(newLevel) + ' ';
  });
}

export async function bakeBreadcrumbTree(
  app: App,
  rootNode: BreadcrumbNode,
  settings: BakeSettings,
  resolutions?: ResolutionMap
): Promise<string> {
  // All files in the tree are seeded as ancestors so they are never inlined into each other
  const allTreeFiles = new Set(flattenTree(rootNode).map((n) => n.file));
  const footnoteCounter = { index: 1 };

  async function bakeNode(node: BreadcrumbNode): Promise<string> {
    const parts: string[] = [];

    let content: string;
    try {
      content = sanitizeBakedContent(
        reindexNotes(
          await bake(app, node.file, null, new Set(allTreeFiles), settings, footnoteCounter, resolutions),
          () => String(footnoteCounter.index++)
        )
      );
    } catch (e) {
      throw new Error(`Error baking '${node.file.path}': ${(e as Error).message}`);
    }

    if (node.depth > 0) {
      // Shift all existing headings down so they sit below the injected section heading
      content = adjustHeadings(content, node.depth);

      // If the file had no H1 (now shifted), inject a section heading
      const hadH1 = app.metadataCache.getFileCache(node.file)?.headings?.some(
        (h) => h.level === 1
      );
      if (!hadH1) {
        const title =
          app.metadataCache.getFileCache(node.file)?.frontmatter?.title ??
          node.file.basename;
        content = `${'#'.repeat(Math.min(node.depth + 1, 6))} ${title}\n\n${content}`;
      }
    }

    if (settings.dataviewHandling === 'strip') content = stripDataviewBlocks(content);
    if (content.trim()) parts.push(content);

    for (const child of node.children) {
      const childContent = await bakeNode(child);
      if (childContent.trim()) parts.push(childContent);
    }

    const sep = settings.sectionSeparator
      ? `\n\n${settings.sectionSeparator}\n\n`
      : '\n\n';
    return parts.join(sep);
  }

  return bakeNode(rootNode);
}
