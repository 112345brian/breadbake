<p align="center">
  <img align="center" width="175" src="https://github.com/mgmeyers/obsidian-easy-bake/blob/master/assets/logo.png?raw=true">
</p>

<h1 align="center">Bripey Bake</h1>

<p align="center">
Compile your Obsidian notes into larger documents. Focused on simplicity, with community improvements baked in. For more complex compilation scenarios, try <a href="https://github.com/kevboh/longform">kevboh's longform plugin</a>.
</p>

> **Disclaimer:** This plugin was vibe coded with AI assistance (Claude). Use at your own risk — review the code before using it in a production vault.

<br>

---

Two commands are available in [Obsidian's command palette](https://help.obsidian.md/Plugins/Command+palette):

- **Bake current file** — follow wikilinks in the current file recursively and inline them into a single document
- **Bake project** — gather all notes that declare themselves part of a named project via frontmatter, order them, and compile into a single document

Links and embeds that exist on their own line will be copied into the compiled document. Inline links will be replaced with the link's text. This process is recursive — links in linked files are also copied into the final document.

For example,

```markdown
## Section One

[[File one]]
[[File two]]

## Section Three

This is an [[File three|inline link]].

[[File four]]
```

will be compiled to:

```markdown
## Section One

Content of file one
Content of file two

## Section Three

This is an inline link.

Content of file four
```

## Project bake

Add a `bake` map to any note's frontmatter, with one entry per project the note belongs to. The value is its position in that project:

```yaml
---
bake:
  my-novel: 3
  another-project: 1
---
```

A note can belong to any number of projects at independent positions.

Run **Bake project**, pick your project from the dropdown, reorder scenes with ↑/↓ if needed, and hit Bake. The modal writes `bake-order` back to each note's frontmatter so the order is saved for next time.

Notes in a project are never inlined into each other even if they link to one another — each scene appears exactly once in the output.

## Settings

All settings are available in the bake modal when you run the command.

| Setting | Default | Description |
|---|---|---|
| Bake embedded markdown | on | Include content of `![[embedded files]]` when on their own line |
| Bake links | on | Include content of `[[links]]` when on their own line |
| Bake links and embeds in lists | on | Also bake links/embeds that occupy an entire list bullet |
| Bake file links | on | Convert `![[image.png]]` to an absolute `file://` path |
| Adjust heading levels | on | Shift headings in embedded files so they nest correctly under the heading that contains the link |
| Skip Excalidraw embeds | on | Leave `.excalidraw` links as-is rather than trying to embed them as text |
| Preserve inline links | on | Keep `[[links]]` that appear inline without display text intact (useful for citation-style references) |
| Remove tasks from output | off | Strip `- [ ]` and `- [x]` task lines from the compiled document |
| Remove tags from output | off | Strip `#tags` from the compiled document |

## Improvements over the original

This fork incorporates the best ideas from the community:

- **Footnote reindexing** — footnotes across multiple merged files are renumbered globally so they never collide
- **Heading level adjustment** — embedded files' headings shift down to nest cleanly under the heading that contains their link
- **Excalidraw exclusion** — `.excalidraw` files are skipped rather than breaking the output
- **Preserve inline links** — citation-style `[[links]]` without display text are left intact
- **Task & tag removal** — optional cleanup of tasks and tags for clean export
- **Block-embed fix** — fixes a bug where partial `![[file#^blockid]]` references could corrupt the output
- **Better error messages** — recursive bake failures report which file caused the problem

## Credits

- [**obsidian-easy-bake**](https://github.com/obsidian-community/obsidian-easy-bake) by [@mgmeyers](https://github.com/mgmeyers) — the original plugin this fork is based on (GPL-3.0)
- [**almarzn/obsidian-easy-bake**](https://github.com/almarzn/obsidian-easy-bake) — footnote reindexing, block-embed fix, error handling
- [**dryezl/obsidian-easy-bake**](https://github.com/dryezl/obsidian-easy-bake) — task/tag removal, inline link preservation
- [**g-martin772/obsidian-master-bake**](https://github.com/g-martin772/obsidian-master-bake) — heading level adjustment, Excalidraw exclusion
