import { validateHeadings } from '../validate';

describe('validateHeadings', () => {
  it('returns no warnings for a well-formed document', () => {
    const doc = `
# Title

## Section A

### Subsection A.1

## Section B

### Subsection B.1

#### Deep B.1.1
`.trim();
    expect(validateHeadings(doc)).toEqual([]);
  });

  it('returns no warnings for a document with no headings', () => {
    expect(validateHeadings('Just some plain text.\nNo headings here.')).toEqual([]);
  });

  it('flags a second H1', () => {
    const doc = `
# Title

## Section

# Another Title
`.trim();
    const warnings = validateHeadings(doc);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('multiple-h1');
    expect(warnings[0].line).toBe(5);
  });

  it('flags a skipped level (H2 → H4)', () => {
    const doc = `
## Section

#### Too deep
`.trim();
    const warnings = validateHeadings(doc);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('skipped-level');
    expect(warnings[0].message).toMatch(/H2.*H4.*skips H3/);
  });

  it('flags a skipped level (H1 → H3)', () => {
    const doc = `
# Title

### Skipped H2
`.trim();
    const warnings = validateHeadings(doc);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('skipped-level');
  });

  it('does not flag going back up the hierarchy', () => {
    // H3 → H2 is valid: it is a sibling section at a higher level
    const doc = `
## Section A

### Subsection

## Section B
`.trim();
    expect(validateHeadings(doc)).toEqual([]);
  });

  it('catches multiple issues', () => {
    const doc = `
# Title

### Skipped H2

# Second H1
`.trim();
    const warnings = validateHeadings(doc);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.kind)).toEqual(['skipped-level', 'multiple-h1']);
  });
});
