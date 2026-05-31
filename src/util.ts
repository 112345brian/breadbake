import {
  BlockSubpathResult,
  CachedMetadata,
  HeadingSubpathResult,
} from 'obsidian';

export const wordCountRE = /\P{Z}*[\p{L}\p{N}]\P{Z}*/gu;
export const commentRE = /(?:<!--[\s\S]*?-->|%%[\s\S]*?(?!%%)[\s\S]+?%%)/g;

export function stripComments(text: string): string {
  return text.replace(commentRE, '');
}

export function getWordCount(text: string): number {
  return (stripComments(text).match(wordCountRE) || []).length;
}

export function dedent(text: string) {
  const firstIndent = text.match(/^([ \t]*)/);
  if (firstIndent) {
    return text.replace(
      //                            Escape tab chars
      new RegExp(`^${firstIndent[0].replace(/\\/g, '\\$&')}`, 'gm'),
      ''
    );
  }
  return text;
}

export function applyIndent(text: string, indent?: string) {
  if (!indent) return text;
  return text.trim().replace(/(\r?\n)/g, `$1${indent}`);
}

export function stripFirstBullet(text: string) {
  if (!text) return text;
  return text.replace(/^[ \t]*(?:[-*+]|[0-9]+[.)]) +/, '');
}

export function stripBlockId(text: string) {
  if (!text) return text;
  return text.replace(/ +\^[^ \n\r]+$/gm, '');
}

export function stripFrontmatter(text: string) {
  if (!text) return text;
  return text.replace(/^---[\s\S]+?\r?\n---(?:\r?\n\s*|$)/, '');
}

export function sanitizeBakedContent(text: string) {
  return stripBlockId(stripFrontmatter(text));
}

export function ensureHeading(text: string, title: string): string {
  const trimmed = text.trimStart();
  if (/^# /m.test(trimmed.split('\n')[0])) return text;
  return `# ${title}\n\n${text}`;
}

export function isEffectivelyEmpty(text: string): boolean {
  return text.trim().length === 0;
}

export function reindexNotes(text: string, next: () => string): string {
  const references: Record<string, string> = {};

  const withNewDefs = text.replace(/^\[\^(\S+?)]: /gm, (_, value) => {
    if (references[value]) {
      throw new Error(`Duplicate footnote reference '${value}'`);
    }
    const nextKey = next();
    references[value] = nextKey;
    return `[^${nextKey}]: `;
  });

  return withNewDefs.replace(/(?!^)\[\^(\S+?)]/gm, (match, value) => {
    if (!references[value]) {
      throw new Error(`Missing footnote reference '${value}'`);
    }
    return `[^${references[value]}]`;
  });
}

export function removeTasks(text: string): string {
  return text.replace(/\s*- \[[ xX]] .*(\n|$)/gm, '\n');
}

export function removeTags(text: string): string {
  return text.replace(/#\w[\w/-]*/g, '');
}

export function convertWikilinksToMarkdown(text: string): string {
  // [[path#subpath|display]] → [display](path.md#subpath)
  text = text.replace(
    /(?<!!)\[\[([^\]|#]+)(#[^\]|]*)?\|([^\]]+)\]\]/g,
    (_, path, sub, display) => `[${display.trim()}](${path.trim()}.md${sub ?? ''})`
  );
  // [[path#subpath]] or [[path]] → [path](path.md#subpath)
  text = text.replace(
    /(?<!!)\[\[([^\]|#]+)(#[^\]|]*)?\]\]/g,
    (_, path, sub) => `[${path.trim()}](${path.trim()}.md${sub ?? ''})`
  );
  return text;
}

export function mergeTagsIntoFrontmatter(outputText: string, tagSets: string[][]): string {
  const merged = [...new Set(tagSets.flat().map((t) => t.replace(/^#/, '').trim()))].sort();
  if (merged.length === 0) return outputText;

  const fmMatch = outputText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (fmMatch) {
    // Replace existing tags line or append to existing frontmatter
    const inner = fmMatch[1];
    const tagsLine = `tags: [${merged.join(', ')}]`;
    const updatedInner = /^tags:/m.test(inner)
      ? inner.replace(/^tags:.*$/m, tagsLine)
      : `${inner}\n${tagsLine}`;
    return outputText.replace(fmMatch[0], `---\n${updatedInner}\n---\n`);
  } else {
    // Prepend a new frontmatter block
    return `---\ntags: [${merged.join(', ')}]\n---\n\n${outputText}`;
  }
}

export function extractSubpath(
  content: string,
  subpathResult: HeadingSubpathResult | BlockSubpathResult,
  cache: CachedMetadata
) {
  let text = content;

  if (subpathResult.type === 'block' && subpathResult.list && cache.listItems) {
    const targetItem = subpathResult.list;
    const ancestors = new Set<number>([targetItem.position.start.line]);
    const start =
      targetItem.position.start.offset - targetItem.position.start.col;

    let end = targetItem.position.end.offset;
    let found = false;

    for (const item of cache.listItems) {
      if (targetItem === item) {
        found = true;
        continue;
      } else if (!found) {
        // Keep seeking until we find the target
        continue;
      }

      if (!ancestors.has(item.parent)) break;
      ancestors.add(item.position.start.line);
      end = item.position.end.offset;
    }

    text = stripBlockId(dedent(content.substring(start, end)));
  } else {
    const start = subpathResult.start.offset;
    const end = subpathResult.end ? subpathResult.end.offset : content.length;
    text = stripBlockId(content.substring(start, end));
  }

  return text;
}
