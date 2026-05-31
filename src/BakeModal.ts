import { Modal, Notice, Setting, TFile } from 'obsidian';

import { bake } from './bake';
import { AmbiguityModal } from './AmbiguityModal';
import { ResolutionMap, autoResolve, collectBakeTargets, detectAmbiguities } from './ambiguity';
import { buildBreadcrumbTree, bakeBreadcrumbTree, flattenTree } from './breadcrumbs';
import { getBCEdgeFields, isBCAvailable } from './bcIntegration';
import { DryRunModal } from './DryRunModal';
import { exportImages } from './imageExport';
import EasyBake from './main';
import { applyTemplates } from './watcher';
import { getWordCount, mergeTagsIntoFrontmatter } from './util';
import { runAllValidations } from './validate';

function disableBtn(btn: HTMLButtonElement) {
  btn.disabled = true;
  btn.removeClass('mod-cta');
  btn.addClass('mod-muted');
}

function enableBtn(btn: HTMLButtonElement) {
  btn.disabled = false;
  btn.removeClass('mod-muted');
  btn.addClass('mod-cta');
}

function toggle(
  name: string,
  desc: string,
  parent: HTMLElement,
  getValue: () => boolean,
  setValue: (v: boolean) => void
) {
  new Setting(parent).setName(name).setDesc(desc).addToggle((t) =>
    t.setValue(getValue()).onChange((v) => setValue(v))
  );
}

function textSetting(
  name: string,
  desc: string,
  placeholder: string,
  parent: HTMLElement,
  getValue: () => string,
  setValue: (v: string) => void
) {
  new Setting(parent).setName(name).setDesc(desc).addText((t) =>
    t.setPlaceholder(placeholder).setValue(getValue()).onChange((v) => setValue(v))
  );
}

export class BakeModal extends Modal {
  private currentMode: 'link' | 'breadcrumb';
  private modeSectionEl!: HTMLElement;
  private btn!: HTMLButtonElement;

  constructor(private plugin: EasyBake, private file: TFile) {
    super(plugin.app);
    this.currentMode = plugin.settings.bakeMode ?? 'link';
  }

  onOpen() {
    this.titleEl.setText('Bake file');
    this.modalEl.addClass('easy-bake-modal');
    this.render();
  }

  private render() {
    const { contentEl } = this;
    const { settings } = this.plugin;
    contentEl.empty();

    // ── File path ──────────────────────────────────────────────────────────
    contentEl
      .createEl('p', { text: 'File: ', cls: 'bripey-file-label' })
      .createEl('strong', { text: this.file.path });

    // ── Mode tabs ──────────────────────────────────────────────────────────
    const tabBar = contentEl.createDiv('bripey-mode-tabs');
    const tabs: HTMLButtonElement[] = [];
    const makeTab = (label: string, mode: 'link' | 'breadcrumb') => {
      const tab = tabBar.createEl('button', { text: label, cls: 'bripey-mode-tab' }) as HTMLButtonElement;
      if (this.currentMode === mode) tab.addClass('is-active');
      tabs.push(tab);
      tab.addEventListener('click', () => {
        this.currentMode = mode;
        settings.bakeMode = mode;
        this.plugin.saveSettings();
        // Only swap the mode section — don't re-render the whole modal
        tabs.forEach((t) => t.removeClass('is-active'));
        tab.addClass('is-active');
        this.modeSectionEl.empty();
        if (mode === 'link') this.renderLinkModeSettings(this.modeSectionEl);
        else this.renderBreadcrumbModeSettings(this.modeSectionEl);
      });
    };
    makeTab('Link bake', 'link');
    makeTab('Breadcrumbs', 'breadcrumb');

    // ── Mode-specific settings ─────────────────────────────────────────────
    this.modeSectionEl = contentEl.createDiv('bripey-mode-section');
    if (this.currentMode === 'link') {
      this.renderLinkModeSettings(this.modeSectionEl);
    } else {
      this.renderBreadcrumbModeSettings(this.modeSectionEl);
    }

    // ── Advanced (collapsed) ───────────────────────────────────────────────
    const details = contentEl.createEl('details', { cls: 'bripey-advanced' });
    details.createEl('summary', { text: 'Advanced options' });
    this.renderAdvancedSettings(details);

    // ── Output name + actions ──────────────────────────────────────────────
    this.renderActions(contentEl);
  }

  // ── Link mode ─────────────────────────────────────────────────────────────
  private renderLinkModeSettings(parent: HTMLElement) {
    const { settings } = this.plugin;
    const save = () => this.plugin.saveSettings();

    textSetting('Max depth', '0 = unlimited. 1 = only direct links from this file.', '0',
      parent, () => String(settings.maxDepth), (v) => { settings.maxDepth = Math.max(0, parseInt(v) || 0); save(); });

    textSetting('Include only files matching',
      'Substring filter on file path — only matching files are baked.',
      'e.g. Beyond Good and Evil', parent,
      () => settings.includePattern, (v) => { settings.includePattern = v; save(); });

    textSetting('Exclude files matching',
      'Files whose path contains this string are left as plain text.',
      'e.g. /people/', parent,
      () => settings.excludePattern, (v) => { settings.excludePattern = v; save(); });

    toggle('Map of contents mode',
      'Treat bulleted wikilinks as a document outline — bullet depth → heading level.',
      parent, () => settings.mocMode, (v) => { settings.mocMode = v; save(); });
  }

  // ── Breadcrumb mode ───────────────────────────────────────────────────────
  private renderBreadcrumbModeSettings(parent: HTMLElement) {
    const { settings } = this.plugin;
    const save = () => this.plugin.saveSettings();
    const bcAvailable = isBCAvailable(this.app);
    const bcFields = getBCEdgeFields(this.app);

    if (bcAvailable) {
      parent.createEl('p', {
        text: `✓ Breadcrumbs plugin detected — ${bcFields.length} configured fields`,
        cls: 'mod-muted',
      });
    }

    const makeFieldSetting = (
      name: string, desc: string,
      getValue: () => string, setValue: (v: string) => void
    ) => {
      const s = new Setting(parent).setName(name).setDesc(desc);
      if (bcAvailable && bcFields.length) {
        s.addDropdown((d) => {
          if (name.includes('Next')) d.addOption('', '(none)');
          bcFields.forEach((f) => d.addOption(f, f));
          d.setValue(getValue()).onChange((v) => { setValue(v); save(); });
        });
      } else {
        s.addText((t) => t.setValue(getValue()).onChange((v) => { setValue(v); save(); }));
      }
    };

    makeFieldSetting('Down field', 'Frontmatter field that defines child notes.',
      () => settings.breadcrumbDownField, (v) => { settings.breadcrumbDownField = v || 'down'; });

    makeFieldSetting('Next field', 'Field used to order siblings via linked-list chain.',
      () => settings.breadcrumbNextField, (v) => { settings.breadcrumbNextField = v; });

    toggle('Combine with body links',
      'Also pull in wikilinks from the file body, merged with frontmatter children.',
      parent, () => settings.breadcrumbCombineWithMoc,
      (v) => { settings.breadcrumbCombineWithMoc = v; save(); });

    textSetting('Include only files matching',
      'Substring filter — breadcrumb children that don\'t match are excluded.',
      'e.g. Beyond Good and Evil', parent,
      () => settings.includePattern, (v) => { settings.includePattern = v; save(); });

    textSetting('Max depth', '0 = unlimited levels of breadcrumb children.', '0',
      parent, () => String(settings.maxDepth),
      (v) => { settings.maxDepth = Math.max(0, parseInt(v) || 0); save(); });
  }

  // ── Advanced settings ─────────────────────────────────────────────────────
  private renderAdvancedSettings(parent: HTMLElement) {
    const { settings } = this.plugin;
    const save = () => this.plugin.saveSettings();

    parent.createEl('p', { text: 'Structure', cls: 'bripey-advanced-group' });
    toggle('Adjust heading levels',
      'Shift headings in embedded files so they nest under the containing heading.',
      parent, () => settings.adjustHeadingLevels, (v) => { settings.adjustHeadingLevels = v; save(); });
    toggle('Skip Excalidraw embeds', 'Leave .excalidraw links as-is.',
      parent, () => settings.skipExcalidraw, (v) => { settings.skipExcalidraw = v; save(); });
    toggle('Preserve inline links',
      'Keep [[links]] without display text intact (citation-style references).',
      parent, () => settings.preserveInlineLinks, (v) => { settings.preserveInlineLinks = v; save(); });
    toggle('Bake links and embeds in lists',
      'Also expand links that occupy an entire list bullet.',
      parent, () => settings.bakeInList, (v) => { settings.bakeInList = v; save(); });
    toggle('Bake file links',
      'Convert ![[image.png]] to an absolute file:// path.',
      parent, () => settings.convertFileLinks, (v) => { settings.convertFileLinks = v; save(); });
    toggle('Structured mode',
      'Auto-inject a heading for files that lack one; skip empty files.',
      parent, () => settings.structuredMode, (v) => { settings.structuredMode = v; save(); });
    toggle('Review ambiguities before baking',
      'Walk through missing headings and empty files one-by-one before baking.',
      parent, () => settings.reviewAmbiguities, (v) => { settings.reviewAmbiguities = v; save(); });

    parent.createEl('p', { text: 'Cleanup', cls: 'bripey-advanced-group' });
    toggle('Strip comments', 'Remove %%comment%% and <!-- HTML --> blocks.',
      parent, () => settings.stripComments, (v) => { settings.stripComments = v; save(); });
    toggle('Remove tasks', 'Strip - [ ] and - [x] lines.',
      parent, () => settings.removeTasks, (v) => { settings.removeTasks = v; save(); });
    toggle('Remove tags', 'Strip #tags.',
      parent, () => settings.removeTags, (v) => { settings.removeTags = v; save(); });
    toggle('Convert wikilinks to Markdown links',
      'Replace [[wikilinks]] with [text](file.md) for portability.',
      parent, () => settings.convertWikilinks, (v) => { settings.convertWikilinks = v; save(); });
    new Setting(parent).setName('Dataview blocks').addDropdown((d) =>
      d.addOption('keep', 'Keep').addOption('strip', 'Strip').addOption('warn', 'Warn')
        .setValue(settings.dataviewHandling)
        .onChange((v) => { settings.dataviewHandling = v as typeof settings.dataviewHandling; save(); })
    );

    parent.createEl('p', { text: 'Export', cls: 'bripey-advanced-group' });
    new Setting(parent)
      .setName('Merge frontmatter fields')
      .setDesc('Comma-separated fields to collect from all files and merge into output.')
      .addToggle((t) => t.setValue(settings.mergeFrontmatter).onChange((v) => { settings.mergeFrontmatter = v; save(); }))
      .addText((t) => t.setPlaceholder('tags').setValue(settings.frontmatterMergeFields)
        .onChange((v) => { settings.frontmatterMergeFields = v; save(); }));
    toggle('Export images to assets folder',
      'Copy images to {name}_assets/ and rewrite links to relative paths.',
      parent, () => settings.exportImages, (v) => { settings.exportImages = v; save(); });
    textSetting('Section separator', 'Text between baked sections (e.g. ---).', '---',
      parent, () => settings.sectionSeparator, (v) => { settings.sectionSeparator = v; save(); });
    textSetting('Header template', 'Note to prepend to the output.', 'Templates/Header',
      parent, () => settings.headerTemplate, (v) => { settings.headerTemplate = v; save(); });
    textSetting('Footer template', 'Note to append to the output.', 'Templates/Footer',
      parent, () => settings.footerTemplate, (v) => { settings.footerTemplate = v; save(); });
  }

  // ── Output name + action buttons ──────────────────────────────────────────
  private renderActions(contentEl: HTMLElement) {
    const { settings } = this.plugin;

    new Setting(contentEl).setName('Output file name').then((setting) => {
      new Setting(contentEl).then((wc) => {
        wc.addButton((b) => b.setButtonText('Calculate word count').onClick(async () => {
          const baked = await bake(this.app, this.file, null, new Set(), settings);
          wc.descEl.setText(`${getWordCount(baked).toLocaleString()} words`);
        }));
      });

      this.modalEl.createDiv('modal-button-container', (el) => {
        let outputName = this.file.basename + '.baked';
        let outputFolder = this.file.parent?.path ? this.file.parent.path + '/' : '';
        let watchAfterBake = false;

        new Setting(el)
          .setName('Watch for changes')
          .addToggle((t) => t.setValue(false).onChange((v) => (watchAfterBake = v)));

        // ── executeBake — shared by Bake btn and Dry run proceed ───────────
        const executeBake = async (manualExclusions: Set<string> = new Set()) => {
          disableBtn(this.btn);
          if (!outputName) { enableBtn(this.btn); return; }

          let resolutions: ResolutionMap | undefined;
          if (manualExclusions.size > 0) {
            resolutions = new Map();
            manualExclusions.forEach((p) => resolutions!.set(p, { action: 'skip' }));
          }

          if (settings.reviewAmbiguities) {
            const targets = this.currentMode === 'link'
              ? await collectBakeTargets(this.app, this.file, new Set(), settings)
              : new Set(flattenTree(buildBreadcrumbTree(this.app, this.file, new Set(), settings)).map((n) => n.file));
            targets.delete(this.file);
            const ambiguities = detectAmbiguities(this.app, [...targets]);
            if (ambiguities.length > 0) {
              const reviewed = await new Promise<ResolutionMap | null>((res) =>
                new AmbiguityModal(this.app, ambiguities, res).open()
              );
              if (!reviewed) { enableBtn(this.btn); return; }
              if (!resolutions) resolutions = new Map();
              reviewed.forEach((v, k) => { if (!resolutions!.has(k)) resolutions!.set(k, v); });
            }
          }

          const { vault } = this.app;
          let baked: string;

          if (this.currentMode === 'breadcrumb') {
            const tree = buildBreadcrumbTree(this.app, this.file, new Set(), settings);
            baked = await bakeBreadcrumbTree(this.app, tree, settings, resolutions);
          } else {
            baked = await bake(this.app, this.file, null, new Set(), settings, undefined, resolutions);
          }

          if (settings.mergeFrontmatter) {
            const targets = this.currentMode === 'link'
              ? await collectBakeTargets(this.app, this.file, new Set(), settings)
              : new Set(flattenTree(buildBreadcrumbTree(this.app, this.file, new Set(), settings)).map((n) => n.file));
            const fields = settings.frontmatterMergeFields.split(',').map((f) => f.trim()).filter(Boolean);
            for (const field of fields) {
              const tagSets = [...targets].map((f) => {
                const val = this.app.metadataCache.getFileCache(f)?.frontmatter?.[field];
                return val ? (Array.isArray(val) ? val.map(String) : [String(val)]) : [];
              });
              if (field === 'tags') baked = mergeTagsIntoFrontmatter(baked, tagSets);
            }
          }

          baked = await applyTemplates(this.app, baked, settings);

          const nextPath = outputFolder + outputName + '.md';
          let existing = vault.getAbstractFileByPath(nextPath);
          if (existing instanceof TFile) {
            await vault.modify(existing, baked);
          } else {
            existing = await vault.create(nextPath, baked);
          }

          if (settings.exportImages && existing instanceof TFile) {
            baked = await exportImages(this.app, baked, existing.parent?.path ?? '', outputName);
            await vault.modify(existing, baked);
          }

          if (watchAfterBake && existing instanceof TFile) {
            const sourceFiles = this.currentMode === 'link'
              ? await collectBakeTargets(this.app, this.file, new Set(), settings)
              : new Set(flattenTree(buildBreadcrumbTree(this.app, this.file, new Set(), settings)).map((n) => n.file));
            this.plugin.watcher.add(
              { outputPath: nextPath, mode: this.currentMode, rootFile: this.file, settings: { ...settings } },
              sourceFiles
            );
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

        // Dry run
        el.createEl('button', { text: 'Dry run' }).addEventListener('click', () => {
          new DryRunModal(this.app, 'link', this.file, null, settings, (excluded) => {
            executeBake(excluded);
          }).open();
        });

        // Copy to clipboard
        el.createEl('button', { text: 'Copy' }).addEventListener('click', async () => {
          let baked: string;
          if (this.currentMode === 'breadcrumb') {
            const tree = buildBreadcrumbTree(this.app, this.file, new Set(), settings);
            baked = await bakeBreadcrumbTree(this.app, tree, settings);
          } else {
            baked = await bake(this.app, this.file, null, new Set(), settings);
          }
          await navigator.clipboard.writeText(baked);
          new Notice('Copied to clipboard.');
          this.close();
        });

        this.btn = el.createEl('button', { cls: 'mod-cta', text: 'Bake' }) as HTMLButtonElement;
        activeWindow.setTimeout(() => this.btn.focus());
        this.btn.addEventListener('click', () => executeBake());

        setting.addText((text) =>
          text.setValue(outputName).onChange((value) => {
            outputName = value;
            if (!value) disableBtn(this.btn);
            else if (this.btn.disabled) enableBtn(this.btn);
          })
        );
      });
    });
  }

  private showWarnings(messages: string[]) {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Baked — warnings');
    contentEl.createEl('p', { text: 'The file was saved, but:' });
    const list = contentEl.createEl('ul');
    messages.forEach((msg) => list.createEl('li', { text: msg }));
    contentEl.createEl('p', {
      cls: 'mod-muted',
      text: 'Check source files for skipped heading levels, multiple H1s, or Dataview blocks.',
    });
    this.modalEl.createDiv('modal-button-container', (el) => {
      el.createEl('button', { text: 'Close', cls: 'mod-cta' })
        .addEventListener('click', () => this.close());
    });
  }
}
