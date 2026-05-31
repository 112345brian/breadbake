export type WarningKind = 'multiple-h1' | 'skipped-level';

export interface HeadingWarning {
  kind: WarningKind;
  message: string;
  line: number;
}

/**
 * Validates that the heading hierarchy in a baked document is idiomatic:
 * - At most one H1 (the document title)
 * - No skipped levels going deeper (e.g. H2 → H4 without an H3)
 *
 * Going back up the hierarchy (H4 → H2) is always valid — that's a sibling section.
 *
 * Returns an array of warnings, empty if the document is well-formed.
 */
export function validateHeadings(text: string): HeadingWarning[] {
  const warnings: HeadingWarning[] = [];
  const lines = text.split('\n');

  let h1Count = 0;
  let prevLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6}) /);
    if (!match) continue;
    const level = match[1].length;

    if (level === 1) {
      h1Count++;
      if (h1Count > 1) {
        warnings.push({
          kind: 'multiple-h1',
          message: `Line ${i + 1}: second H1 found — baked document should have at most one`,
          line: i + 1,
        });
      }
    }

    if (prevLevel > 0 && level > prevLevel + 1) {
      warnings.push({
        kind: 'skipped-level',
        message: `Line ${i + 1}: heading jumps from H${prevLevel} to H${level} (skips H${prevLevel + 1})`,
        line: i + 1,
      });
    }

    prevLevel = level;
  }

  return warnings;
}
