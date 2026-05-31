/**
 * Tests the isInline detection logic against real vault content.
 *
 * The Nietzsche chapter file is the canonical test case: it has
 * standalone links (chapters that SHOULD be baked) mixed with inline
 * people/concept links (which should become plain text, NOT be expanded).
 */

import * as fs from 'fs';
import * as path from 'path';

const lineStartRE = /(?:^|\n) *$/;
const listLineStartRE = /(?:^|\n)([ \t]*)(?:[-*+]|[0-9]+[.)]) +$/;
const lineEndRE = /^ *(?:\r?\n|$)/;

function isInlineLink(text: string, start: number, end: number): boolean {
  const before = text.substring(0, start);
  const after = text.substring(end);
  const listMatch = before.match(listLineStartRE);
  return !(listMatch || lineStartRE.test(before)) || !lineEndRE.test(after);
}

// Parse wikilinks manually from markdown text for testing
function parseLinks(text: string): Array<{ link: string; start: number; end: number; displayText?: string }> {
  const results = [];
  const re = /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ link: m[1], start: m.index, end: m.index + m[0].length, displayText: m[2] });
  }
  return results;
}

describe('isInline detection — nietzsche root file', () => {
  const rootContent = fs.readFileSync(
    path.join(__dirname, 'fixtures/nietzsche-root.md'),
    'utf8'
  );

  it('treats the 9 chapter links as non-inline (standalone lines)', () => {
    const links = parseLinks(rootContent);
    const chapterLinks = links.filter((l) => l.link.startsWith('Beyond Good and Evil'));
    expect(chapterLinks.length).toBe(9);
    for (const link of chapterLinks) {
      expect(isInlineLink(rootContent, link.start, link.end)).toBe(false);
    }
  });
});

describe('isInline detection — chapter file (bge-ch1)', () => {
  const chapterContent = fs.readFileSync(
    path.join(__dirname, 'fixtures/bge-ch1.md'),
    'utf8'
  );

  it('treats person links (nietzsche-friedrich, spinoza-benedict, kant-immanuel) as inline', () => {
    const personLinks = parseLinks(chapterContent).filter((l) =>
      ['nietzsche-friedrich', 'spinoza-benedict', 'kant-immanuel', 'schopenhauer-arthur'].includes(l.link)
    );
    // There should be some person links
    expect(personLinks.length).toBeGreaterThan(0);
    // All should be inline (mid-paragraph)
    for (const link of personLinks) {
      expect(isInlineLink(chapterContent, link.start, link.end)).toBe(true);
    }
  });

  it('treats block embeds (![[...]]) as non-inline', () => {
    const embeds = parseLinks(chapterContent).filter((l) =>
      ['Behind All Logic', 'Nietzsche criticizes Stoicism'].some((name) => l.link.startsWith(name))
    );
    expect(embeds.length).toBeGreaterThan(0);
    for (const embed of embeds) {
      // These are on their own lines — should be non-inline
      expect(isInlineLink(chapterContent, embed.start, embed.end)).toBe(false);
    }
  });

  it('treats the cross-chapter link as inline (embedded in paragraph)', () => {
    // "in [[Beyond Good and Evil - What is Noble|What is Noble]] Nietzsche actually says..."
    const crossLink = parseLinks(chapterContent).find(
      (l) => l.link === 'Beyond Good and Evil - What is Noble' && l.displayText === 'What is Noble'
    );
    expect(crossLink).toBeDefined();
    expect(isInlineLink(chapterContent, crossLink!.start, crossLink!.end)).toBe(true);
  });
});
