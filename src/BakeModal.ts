import { Modal, Notice, Setting, TFile } from 'obsidian';

import { bake } from './bake';
import { AmbiguityModal } from './AmbiguityModal';
import { ResolutionMap, autoResolve, collectBakeTargets, detectAmbiguities } from './ambiguity';
import { DryRunModal } from './DryRunModal';
import { exportImages } from './imageExport';
import EasyBake from './main';
import { applyTemplates } from './watcher';
import { getWordCount, mergeTagsIntoFrontmatter } from './util';
import { runAllValidations } from './validate';

function disableBtn(btn: HTMLButtonElement) {
  btn.removeClass('mod-cta');
  btn.addClass('mod-muted');
  btn.setAttrs({
    disabled: 'true',
    'aria-disabled': 'true',
  });
}

function enableBtn(btn: HTMLButtonElement) {
  btn.removeClass('mod-muted');
  btn.addClass('mod-cta');
  btn.setAttrs({
    disabled: 'false',
    'aria-disabled': 'false',
  });
}

export class BakeModal extends Modal {
  constructor(plugin: EasyBake, file: TFile) {
    super(plugin.app);

    const { contentEl } = this;
    const { settings } = plugin;

    this.titleEl.setText('Bake file');
    this.modalEl.addClass('mod-narrow', 'easy-bake-modal');
    this.contentEl
      .createEl('p', { text: 'Input file: ' })
      .createEl('strong', { text: file.path });

    contentEl.createEl('h3', { text: 'Scope' });

    new Setting(contentEl)
      .setName('Max depth')
      .setDesc('How many levels of links to follow. 0 = unlimited. Set to 1 to only include files directly linked from this file.')
      .addText((text) =>
        text
          .setValue(String(settings.maxDepth))
          .onChange((value) => {
            settings.maxDepth = Math.max(0, parseInt(value) || 0);
            plugin.saveSettings();
          })
      );

    new Setting(contentEl)
      .setName('Include only files matching')
      .setDesc('Case-insensitive substring filter. Only links whose file path contains this string will be followed and baked. Leave empty for no filter.')
      .addText((text) =>
        text
          .setPlaceholder('e.g. Beyond Good and Evil')
          .setValue(settings.includePattern)
          .onChange((value) => {
            settings.includePattern = value;
            plugin.saveSettings();
          })
      );

    new Setting(contentEl)
      .setName('Exclude files matching')
      .setDesc('Any link whose file path contains this string will be left as plain text rather than baked.')
      .addText((text) =>
        text
          .setPlaceholder('e.g. /people/')
          .setValue(settings.excludePattern)
          .onChange((value) => {
            settings.excludePattern = value;
            plugin.saveSettings();
          })
      );

    contentEl.createEl('h3', { text: 'What to include' });

    new Setting(contentEl)
      .setName('Bake embedded markdown')
      .setDesc(
        'Include the content of ![[embedded markdown files]] when the link is on its own line.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.bakeEmbeds).onChange((value) => {
          settings.bakeEmbeds = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Bake links')
      .setDesc(
        'Include the content of [[any link]] when it is on its own line.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.bakeLinks).onChange((value) => {
          settings.bakeLinks = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Bake links and embeds in lists')
      .setDesc(
        'Include the content of [[any link]] or ![[embedded markdown file]] when it takes up an entire list bullet.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.bakeInList).onChange((value) => {
          settings.bakeInList = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Bake file links')
      .setDesc(
        'Convert links to ![[non-markdown files.png]] to ![](file:///full/path/to/non-markdown%20files.png)'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.convertFileLinks).onChange((value) => {
          settings.convertFileLinks = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Adjust heading levels')
      .setDesc(
        'Shift headings in embedded files so they nest under the heading that contains the link.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.adjustHeadingLevels).onChange((value) => {
          settings.adjustHeadingLevels = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Skip Excalidraw embeds')
      .setDesc(
        'Leave ![[file.excalidraw]] links as-is instead of trying to embed them as text.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.skipExcalidraw).onChange((value) => {
          settings.skipExcalidraw = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Preserve inline links')
      .setDesc(
        'Keep [[links]] that appear inline without display text as-is, rather than stripping their brackets. Useful for citation-style references.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.preserveInlineLinks).onChange((value) => {
          settings.preserveInlineLinks = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Remove tasks from output')
      .setDesc('Strip task checkboxes (- [ ] and - [x]) from the compiled document.')
      .addToggle((toggle) =>
        toggle.setValue(settings.removeTasks).onChange((value) => {
          settings.removeTasks = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Remove tags from output')
      .setDesc('Strip #tags from the compiled document.')
      .addToggle((toggle) =>
        toggle.setValue(settings.removeTags).onChange((value) => {
          settings.removeTags = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Strip Obsidian comments')
      .setDesc('Remove %%comment%% and <!-- HTML comment --> blocks from the compiled output.')
      .addToggle((toggle) =>
        toggle.setValue(settings.stripComments).onChange((value) => {
          settings.stripComments = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Convert wikilinks to Markdown links')
      .setDesc('Replace remaining [[wikilinks]] in the output with standard [text](file.md) links for portability outside Obsidian.')
      .addToggle((toggle) =>
        toggle.setValue(settings.convertWikilinks).onChange((value) => {
          settings.convertWikilinks = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Merge frontmatter fields')
      .setDesc('Collect the specified fields from all included files and merge them into the output frontmatter.')
      .addToggle((toggle) =>
        toggle.setValue(settings.mergeFrontmatter).onChange((value) => {
          settings.mergeFrontmatter = value;
          plugin.saveSettings();
        })
      )
      .addText((text) =>
        text
          .setPlaceholder('tags')
          .setValue(settings.frontmatterMergeFields)
          .onChange((value) => {
            settings.frontmatterMergeFields = value;
            plugin.saveSettings();
          })
      );

    new Setting(contentEl)
      .setName('Export images to assets folder')
      .setDesc('Copy referenced images into a {name}_assets/ folder next to the output file and rewrite links to relative paths.')
      .addToggle((toggle) =>
        toggle.setValue(settings.exportImages).onChange((value) => {
          settings.exportImages = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Section separator')
      .setDesc('Text inserted between baked sections (e.g. ---). Leave empty for none.')
      .addText((text) =>
        text.setValue(settings.sectionSeparator).onChange((value) => {
          settings.sectionSeparator = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Dataview blocks')
      .setDesc('How to handle Dataview/DataviewJS code blocks in the output.')
      .addDropdown((drop) =>
        drop
          .addOption('keep', 'Keep as-is')
          .addOption('strip', 'Strip')
          .addOption('warn', 'Warn after baking')
          .setValue(settings.dataviewHandling)
          .onChange((value) => {
            settings.dataviewHandling = value as 'keep' | 'strip' | 'warn';
            plugin.saveSettings();
          })
      );

    new Setting(contentEl)
      .setName('Header template')
      .setDesc('Note to prepend to the output (path or wikilink without brackets).')
      .addText((text) =>
        text.setPlaceholder('Templates/Header').setValue(settings.headerTemplate).onChange((value) => {
          settings.headerTemplate = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Footer template')
      .setDesc('Note to append to the output.')
      .addText((text) =>
        text.setPlaceholder('Templates/Footer').setValue(settings.footerTemplate).onChange((value) => {
          settings.footerTemplate = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Map of contents mode')
      .setDesc(
        'Treat bulleted wikilinks as a document outline. Each link becomes a section heading whose level is derived from its list indentation (top-level → H2, one indent → H3, …). The linked file\'s own H1 shifts to that level; if it has none, the filename is used as the heading.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.mocMode).onChange((value) => {
          settings.mocMode = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Structured mode')
      .setDesc(
        'Automatically resolve ambiguous structure: inject a heading for any embedded file that lacks one (using its frontmatter title or filename), and skip files that are empty after processing.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.structuredMode).onChange((value) => {
          settings.structuredMode = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl)
      .setName('Review ambiguities before baking')
      .setDesc(
        'Scan files first and walk through each ambiguous situation — missing headings, empty files — so you can decide how to handle each one individually.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.reviewAmbiguities).onChange((value) => {
          settings.reviewAmbiguities = value;
          plugin.saveSettings();
        })
      );

    new Setting(contentEl).setName('Output file name').then((setting) => {
      new Setting(contentEl).then((setting) => {
        setting.addButton((btn) =>
          btn.setButtonText('Calculate word count').onClick(async () => {
            const baked = await bake(this.app, file, null, new Set(), settings);

            setting.descEl.setText(getWordCount(baked).toString());
          })
        );
      });

      this.modalEl.createDiv('modal-button-container', (el) => {
        let outputName = file.basename + '.baked';
        let outputFolder = file.parent?.path || '';

        if (outputFolder) outputFolder += '/';

        let watchAfterBake = false;
        new Setting(el)
          .setName('Watch for changes')
          .setDesc('Automatically rebake when source files are modified.')
          .addToggle((t) => t.setValue(false).onChange((v) => (watchAfterBake = v)));

        // Shared bake execution — called by both the Bake button and the Dry run proceed path
        const executeBake = async (manualExclusions: Set<string> = new Set()) => {
          disableBtn(btn);
          if (!outputName) { enableBtn(btn); return; }

          let resolutions: ResolutionMap | undefined;

          // Seed manual exclusions from the dry run toggle list
          if (manualExclusions.size > 0) {
            resolutions = new Map();
            manualExclusions.forEach((path) => resolutions!.set(path, { action: 'skip' }));
          }

          if (settings.reviewAmbiguities) {
            const targets = await collectBakeTargets(this.app, file, new Set(), settings);
            targets.delete(file);
            const ambiguities = detectAmbiguities(this.app, [...targets]);
            if (ambiguities.length > 0) {
              const reviewed = await new Promise<ResolutionMap | null>((res) =>
                new AmbiguityModal(this.app, ambiguities, res).open()
              );
              if (!reviewed) { enableBtn(btn); return; }
              // Merge with manual exclusions
              reviewed.forEach((v, k) => { if (!resolutions!.has(k)) resolutions!.set(k, v); });
            }
          }

          const { vault } = this.app;
          let baked = await bake(this.app, file, null, new Set(), settings, undefined, resolutions);

          // Frontmatter merging
          if (settings.mergeFrontmatter) {
            const fields = settings.frontmatterMergeFields.split(',').map((f) => f.trim()).filter(Boolean);
            const targets = await collectBakeTargets(this.app, file, new Set(), settings);
            for (const field of fields) {
              const tagSets = [...targets].map((f) => {
                const val = this.app.metadataCache.getFileCache(f)?.frontmatter?.[field];
                if (!val) return [];
                return Array.isArray(val) ? val.map(String) : [String(val)];
              });
              if (field === 'tags') baked = mergeTagsIntoFrontmatter(baked, tagSets);
            }
          }

          const nextPath = outputFolder + outputName + '.md';
          let existing = vault.getAbstractFileByPath(nextPath);
          if (existing instanceof TFile) {
            await vault.modify(existing, baked);
          } else {
            existing = await vault.create(nextPath, baked);
          }

          baked = await applyTemplates(this.app, baked, settings);

          if (settings.exportImages && existing instanceof TFile) {
            baked = await exportImages(this.app, baked, existing.parent?.path ?? '', outputName);
            await vault.modify(existing, baked);
          }

          if (watchAfterBake && existing instanceof TFile) {
            const sourceFiles = await collectBakeTargets(this.app, file, new Set(), settings);
            plugin.watcher.add({ outputPath: nextPath, mode: 'link', rootFile: file, settings: { ...settings } }, sourceFiles);
          }

          if (existing instanceof TFile) {
            this.app.workspace.getLeaf('tab').openFile(existing);
          }

          const warnings = runAllValidations(baked).filter(
            (w) => w.kind !== 'dataview-block' || settings.dataviewHandling === 'warn'
          );
          if (warnings.length > 0) {
            this.showWarnings(warnings.map((w) => w.message));
            return;
          }
          this.close();
        };

        // --- Dry run ---
        el.createEl('button', { text: 'Dry run' }).addEventListener('click', () => {
          new DryRunModal(this.app, 'link', file, null, settings, (excluded) => {
            executeBake(excluded);
          }).open();
        });

        // --- Copy to clipboard ---
        el.createEl('button', { text: 'Copy to clipboard' }).addEventListener('click', async () => {
          const baked = await bake(this.app, file, null, new Set(), settings);
          await navigator.clipboard.writeText(baked);
          new Notice('Baked content copied to clipboard.');
          this.close();
        });

        const btn = el.createEl('button', {
          cls: 'mod-cta',
          text: 'Bake',
        });

        activeWindow.setTimeout(() => btn.focus());

        btn.addEventListener('click', () => executeBake());


        setting.addText((text) =>
          text.setValue(outputName).onChange((value) => {
            outputName = value;
            if (!value) {
              disableBtn(btn);
            } else if (btn.disabled) {
              enableBtn(btn);
            }
          })
        );
      });
    });
  }

  private showWarnings(messages: string[]) {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Baked — heading warnings');

    contentEl.createEl('p', {
      text: 'The baked file was saved, but the heading structure may not be idiomatic:',
    });

    const list = contentEl.createEl('ul');
    messages.forEach((msg) => list.createEl('li', { text: msg }));

    contentEl.createEl('p', {
      cls: 'mod-muted',
      text: 'This usually means a source file skips heading levels (e.g. H1 → H3) or contains multiple H1s. Check the linked files and re-bake, or ignore if intentional.',
    });

    this.modalEl.createDiv('modal-button-container', (el) => {
      el.createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () =>
        this.close()
      );
    });
  }
}
