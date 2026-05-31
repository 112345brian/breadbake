import { App, TFile, parseLinktext } from 'obsidian';
import { BakeSettings } from './main';
import { bake } from './bake';
import { reindexNotes, sanitizeBakedContent } from './util';
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

    if (content.trim()) parts.push(content);

    for (const child of node.children) {
      const childContent = await bakeNode(child);
      if (childContent.trim()) parts.push(childContent);
    }

    return parts.join('\n\n');
  }

  return bakeNode(rootNode);
}
