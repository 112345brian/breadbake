/**
 * Tests that MOC mode produces idiomatic heading output.
 *
 * These tests work at the level of the heading-shift logic directly,
 * without needing the Obsidian API. The contract is: after MOC expansion,
 * validateHeadings() should return no warnings.
 */

import { validateHeadings } from '../validate';

// Mirrors the adjustHeadings function in bake.ts
function adjustHeadings(md: string, shift: number): string {
  if (!shift) return md;
  return md.replace(/^(#{1,6}) /gm, (_, hashes) => {
    const newLevel = Math.min(hashes.length + shift, 6);
    return '#'.repeat(newLevel) + ' ';
  });
}

// Simulates what MOC mode does for a single file at a given bullet depth
function mocExpand(fileContent: string, depth: number, titleFallback: string): string {
  const shift = 1 + depth;
  const shifted = adjustHeadings(fileContent, shift);
  // Detect if file had an H1 (before shifting)
  const hadH1 = /^# /m.test(fileContent);
  if (hadH1) return shifted;
  return `${'#'.repeat(2 + depth)} ${titleFallback}\n\n${shifted}`;
}

describe('MOC mode heading shifts', () => {
  describe('file with H1 at depth 0 (top-level bullet)', () => {
    const file = `# Chapter One\n\nSome content.\n\n## A section\n\nMore content.`;
    const expanded = mocExpand(file, 0, 'Chapter One');

    it('shifts H1 to H2', () => {
      expect(expanded).toMatch(/^## Chapter One/m);
    });

    it('shifts H2 to H3', () => {
      expect(expanded).toMatch(/^### A section/m);
    });

    it('produces valid heading structure', () => {
      expect(validateHeadings(expanded)).toEqual([]);
    });
  });

  describe('file with H1 at depth 1 (one-indent bullet)', () => {
    const file = `# Section\n\nContent.\n\n## Subsection`;
    const expanded = mocExpand(file, 1, 'Section');

    it('shifts H1 to H3', () => {
      expect(expanded).toMatch(/^### Section/m);
    });

    it('shifts H2 to H4', () => {
      expect(expanded).toMatch(/^#### Subsection/m);
    });

    it('produces valid heading structure', () => {
      expect(validateHeadings(expanded)).toEqual([]);
    });
  });

  describe('file without H1 at depth 0', () => {
    const file = `Some content.\n\n## A section`;
    const expanded = mocExpand(file, 0, 'My File');

    it('injects an H2 from the filename', () => {
      expect(expanded).toMatch(/^## My File/m);
    });

    it('shifts the internal H2 to H3', () => {
      expect(expanded).toMatch(/^### A section/m);
    });

    it('produces valid heading structure', () => {
      expect(validateHeadings(expanded)).toEqual([]);
    });
  });

  describe('file without H1 at depth 1', () => {
    const file = `Some content.\n\n## A section`;
    const expanded = mocExpand(file, 1, 'My File');

    it('injects an H3', () => {
      expect(expanded).toMatch(/^### My File/m);
    });

    it('shifts the internal H2 to H4', () => {
      expect(expanded).toMatch(/^#### A section/m);
    });

    it('produces valid heading structure', () => {
      expect(validateHeadings(expanded)).toEqual([]);
    });
  });

  describe('full MOC document simulation', () => {
    // Simulates baking a root file whose bullets are:
    //   * [[Chapter 1]]   (depth 0, has H1)
    //   * [[Chapter 2]]   (depth 0, no H1)
    //      * [[Section 2.1]] (depth 1, has H1)
    it('produces a fully valid document', () => {
      const ch1 = mocExpand(`# Chapter One\n\nIntro.\n\n## Background`, 0, 'Chapter One');
      const ch2 = mocExpand(`No title here.\n\n## Overview`, 0, 'Chapter Two');
      const sec21 = mocExpand(`# Section 2.1\n\nDetails.\n\n## Sub`, 1, 'Section 2.1');

      const full = `# Document Title\n\n${ch1}\n\n${ch2}\n\n${sec21}`;
      expect(validateHeadings(full)).toEqual([]);
    });
  });
});
