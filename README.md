<p align="center">
  <img align="center" width="175" src="https://github.com/mgmeyers/obsidian-easy-bake/blob/master/assets/logo.png?raw=true">
</p>

<h1 align="center">Bripey Bake</h1>

<p align="center">
  Compile Obsidian notes into a single document — three ways.
</p>

<p align="center">
  <em>Fork of <a href="https://github.com/obsidian-community/obsidian-easy-bake">obsidian-easy-bake</a> · vibe coded with Claude · use at your own risk</em>
</p>

---

## Why Bripey Bake?

The upstream plugin is called "Easy Bake" — and it is easy, which is great. But this fork has grown well beyond a simple wikilink expander. It now has three distinct bake modes, project and breadcrumb-based document assembly, per-file settings, interactive ambiguity resolution, image export, heading validation, and a test suite. Calling it "Easy Bake" started to feel like false advertising.

It pulls heavily from several community forks (all credited below), so the "easy-bake" lineage still felt right — but it needed a new name. And since my name is Bri, and this thing is pretty squarely mine at this point — it's **Bripey Bake**.

---

Bripey Bake adds three commands to [Obsidian's command palette](https://help.obsidian.md/Plugins/Command+palette), each representing a different way to assemble notes into a single output file.

---

## Commands

### Bake current file

The classic approach. Starting from the current note, any `[[wikilink]]` or `![[embed]]` that sits on its own line is replaced inline with the full contents of that file. The process is recursive — links inside linked files are also expanded.

```markdown
## Section One

[[Chapter One]]
[[Chapter Two]]

## Section Three

This is an [[inline link]].

[[Chapter Four]]
```

Becomes:

```markdown
## Section One

Content of chapter one…
Content of chapter two…

## Section Three

This is an inline link.

Content of chapter four…
```

**Map of contents mode** changes how list-based links are handled. Instead of indenting the content, bullet depth determines the heading level of the embedded content — making a bulleted list of links behave like a document outline:

```markdown
* [[Part One]]          → ## Part One
   * [[Chapter 1]]      → ### Chapter 1
   * [[Chapter 2]]      → ### Chapter 2
* [[Part Two]]          → ## Part Two
```

---

### Bake project

Notes declare themselves as part of a named project in their own frontmatter. The plugin collects all matching notes, lets you order them, and compiles them in sequence.

**Single-project** shorthand:
```yaml
---
bake-project: my-novel
bake-order: 3
---
```

**Multi-project** map (a note can belong to multiple projects at independent positions):
```yaml
---
bake:
  my-novel: 3
  another-project: 1
---
```

Run **Bake project**, pick from the dropdown, reorder with ↑/↓ if needed, and hit Bake. The `bake-order` values are written back to each note's frontmatter so the order is remembered. Notes in a project are never inlined into each other even if they link to one another.

---

### Bake from breadcrumbs

Uses frontmatter relationship fields — the same convention as the [Breadcrumbs plugin](https://github.com/SkepticMystic/breadcrumbs) — to infer document hierarchy. The plugin reads a configurable field (default: `down`) from the current file, recurses into each child's frontmatter, and builds a tree.

```yaml
---
title: My Novel
down:
  - "[[Part One]]"
  - "[[Part Two]]"
  - "[[Epilogue]]"
---
```

Before baking, the modal shows the detected tree with heading-level badges:

```
📄 My Novel (root)
  H2  Part One
    H3  Chapter 1
    H3  Chapter 2
  H2  Part Two
  H2  Epilogue
```

Heading levels are determined by depth: depth 1 → H2, depth 2 → H3, and so on. A file's existing H1 is shifted to the right level; if it has no H1, the filename (or frontmatter `title`) is injected.

The Breadcrumbs plugin is **not required** — any frontmatter field name works. **Combination mode** also merges body wikilinks into the child list so you can mix frontmatter structure with MOC-style body lists.

---

## Output options

All options are available as toggles in the bake modal. Settings persist between sessions.

### What gets included

| Setting | Default | Description |
|---|---|---|
| Bake embedded markdown | on | Expand `![[embedded files]]` when on their own line |
| Bake links | on | Expand `[[links]]` when on their own line |
| Bake links and embeds in lists | on | Also expand links that occupy an entire list bullet |
| Bake file links | on | Convert `![[image.png]]` to an absolute `file://` path |
| Skip Excalidraw embeds | on | Leave `.excalidraw` links as-is |
| Preserve inline links | on | Keep `[[links]]` that appear inline without display text (e.g. citation-style references) rather than stripping their brackets |

### Structure

| Setting | Default | Description |
|---|---|---|
| Map of contents mode | off | Treat bulleted wikilinks as a document outline; bullet depth → heading level |
| Adjust heading levels | on | Shift headings in embedded files so they nest under the heading containing the link |
| Structured mode | off | Auto-inject a heading for any embedded file that lacks one (`title` frontmatter → filename), and skip empty files |
| Review ambiguities before baking | off | Walk through each structural ambiguity (missing headings, empty files) one at a time before baking, with per-item choices. Takes precedence over structured mode. |

### Cleanup

| Setting | Default | Description |
|---|---|---|
| Strip Obsidian comments | off | Remove `%%comment%%` and `<!-- HTML comment -->` blocks |
| Remove tasks from output | off | Strip `- [ ]` and `- [x]` lines |
| Remove tags from output | off | Strip `#tags` |
| Convert wikilinks to Markdown links | off | Replace remaining `[[wikilinks]]` with standard `[text](file.md)` links for portability outside Obsidian |

### Export

| Setting | Default | Description |
|---|---|---|
| Merge frontmatter fields | off | Collect specified fields from all included files and merge into the output frontmatter. Accepts a comma-separated list of field names (default: `tags`). Arrays are deduplicated and sorted. |
| Export images to assets folder | off | Copy referenced images into a `{name}_assets/` folder next to the output file and rewrite links to relative paths |

---

## Per-file settings

Any note can override global settings for its own content by adding a `bake-settings` key to its frontmatter. Overrides apply only to that file; linked files still use global settings.

```yaml
---
bake-settings:
  removeTasks: true
  stripComments: true
---
```

---

## Other features

**Dry run** — a button in the bake modal that shows which files would be included, their nesting depth, and an estimated word count, without writing anything. A "Proceed to bake" button continues to the actual bake.

**Copy to clipboard** — bakes in memory and copies to the clipboard without writing a file. Useful for pasting into Google Docs, email, etc.

**Heading validation** — after every bake, the output is checked for common heading issues (multiple H1s, skipped levels). If any are found the modal stays open and lists them rather than silently closing.

**Footnote reindexing** — footnote references across all merged files are renumbered globally so they never collide.

---

## Credits

Built on top of, and incorporating ideas from:

- [**obsidian-easy-bake**](https://github.com/obsidian-community/obsidian-easy-bake) by [@mgmeyers](https://github.com/mgmeyers) — the original plugin (GPL-3.0)
- [**almarzn/obsidian-easy-bake**](https://github.com/almarzn/obsidian-easy-bake) — footnote reindexing, block-embed fix, error handling
- [**dryezl/obsidian-easy-bake**](https://github.com/dryezl/obsidian-easy-bake) — task/tag removal, inline link preservation
- [**g-martin772/obsidian-master-bake**](https://github.com/g-martin772/obsidian-master-bake) — heading level adjustment, Excalidraw exclusion
