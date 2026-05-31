import { Modal, Notice, Setting, TFile } from 'obsidian';

import { bake } from './bake';
import { AmbiguityModal } from './AmbiguityModal';
import { ResolutionMap, collectBakeTargets, detectAmbiguities } from './ambiguity';
import { buildBreadcrumbTree, bakeBreadcrumbTree, flattenTree } from './breadcrumbs';
import { getBCEdgeFields, isBCAvailable } from './bcIntegration';
import { exportImages } from './imageExport';
import EasyBake from './main';
import { applyTemplates } from './watcher';
import { mergeTagsIntoFrontmatter } from './util';
import { runAllValidations } from './validate';
import { traceBake, DryRunEntry } from './dryRun';

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

export class BakeModal extends Modal {
  private currentMode: 'link' | 'breadcrumb';
  private modeSectionEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private previewCountEl!: HTMLElement;
  private btn!: HTMLButtonElement;
  private excluded = new Set<string>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private plugin: EasyBake, private file: TFile) {
    super(plugin.app);
    this.currentMode = plugin.settings.bakeMode ?? 'link';
  }

  onOpen() {
    this.titleEl.setText('Bake file');
    this.modalEl.addClass('easy-bake-modal');
    this.build();
    this.scheduleRefresh(0);
  }

  onClose() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  // ── Full build (runs once) ────────────────────────────────────────────────
  private build() {
    const { contentEl } = this;
    const { settings } = this.plugin;
    contentEl.empty();

    // Clear any stale button bars (safety net)
    this.modalEl.querySelectorAll('.modal-button-container').forEach((el) => el.remove());

    const save = () => {
      this.plugin.saveSettings();
      this.scheduleRefresh();
    };

    // ── Two-column wrapper ────────────────────────────────────────────────
    const body = contentEl.createDiv('bripey-body');
    const leftCol = body.createDiv('bripey-settings-col');
    const rightCol = body.createDiv('bripey-preview-col');

    // ── File label ────────────────────────────────────────────────────────
    leftCol
      .createEl('p', { text: 'File: ', cls: 'bripey-file-label' })
      .createEl('strong', { text: this.file.basename });

    // ── Mode tabs ─────────────────────────────────────────────────────────
    const tabBar = leftCol.createDiv('bripey-mode-tabs');
    const tabs: HTMLButtonElement[] = [];
    const makeTab = (label: string, mode: 'link' | 'breadcrumb') => {
      const tab = tabBar.createEl('button', { text: label, cls: 'bripey-mode-tab' }) as HTMLButtonElement;
      if (this.currentMode === mode) tab.addClass('is-active');
      tabs.push(tab);
      tab.addEventListener('click', () => {
        this.currentMode = mode;
        settings.bakeMode = mode;
        this.plugin.saveSettings();
        tabs.forEach((t) => t.removeClass('is-active'));
        tab.addClass('is-active');
        this.modeSectionEl.empty();
        if (mode === 'link') this.renderLinkSettings(this.modeSectionEl, save);
        else this.renderBreadcrumbSettings(this.modeSectionEl, save);
        this.scheduleRefresh(0);
      });
    };
    makeTab('Link bake', 'link');
    makeTab('Breadcrumbs', 'breadcrumb');

    // ── Mode-specific settings ────────────────────────────────────────────
    this.modeSectionEl = leftCol.createDiv('bripey-mode-section');
    if (this.currentMode === 'link') this.renderLinkSettings(this.modeSectionEl, save);
    else this.renderBreadcrumbSettings(this.modeSectionEl, save);

    // ── Advanced (collapsed) ──────────────────────────────────────────────
    const details = leftCol.createEl('details', { cls: 'bripey-advanced' });
    details.createEl('summary', { text: 'Advanced options' });
    this.renderAdvanced(details, save);

    // ── Preview column ────────────────────────────────────────────────────
    this.previewCountEl = rightCol.createEl('p', { cls: 'bripey-preview-count mod-muted' });
    rightCol.createEl('p', { text: 'Click a file to exclude it.', cls: 'mod-muted bripey-preview-hint' });
    this.previewEl = rightCol.createDiv('bripey-preview-list');

    // ── Bottom bar ────────────────────────────────────────────────────────
    this.renderActions(contentEl, save);
  }

  // ── Link mode settings ───────────────────────────────────────────────────
  private renderLinkSettings(parent: HTMLElement, save: () => void) {
    const s = this.plugin.settings;
    this.txt(parent, 'Max depth', '0 = unlimited. 1 = only direct links.', '0',
      () => String(s.maxDepth), (v) => { s.maxDepth = Math.max(0, parseInt(v) || 0); save(); });
    this.txt(parent, 'Include files matching', 'Only paths containing this string are followed.',
      'e.g. Beyond Good and Evil', () => s.includePattern, (v) => { s.includePattern = v; save(); });
    this.txt(parent, 'Exclude files matching', 'Paths containing this string are left as plain text.',
      'e.g. /people/', () => s.excludePattern, (v) => { s.excludePattern = v; save(); });
    this.tog(parent, 'Map of contents mode', 'Bullet depth → heading level.',
      () => s.mocMode, (v) => { s.mocMode = v; save(); });
  }

  // ── Breadcrumb mode settings ─────────────────────────────────────────────
  private renderBreadcrumbSettings(parent: HTMLElement, save: () => void) {
    const s = this.plugin.settings;
    const bcAvailable = isBCAvailable(this.app);
    const bcFields = getBCEdgeFields(this.app);

    if (bcAvailable) {
      parent.createEl('p', { text: `✓ Breadcrumbs — ${bcFields.length} fields`, cls: 'mod-muted bripey-bc-badge' });
    }

    const fieldSetting = (name: string, desc: string, get: () => string, set: (v: string) => void, allowNone = false) => {
      const setting = new Setting(parent).setName(name).setDesc(desc);
      if (bcAvailable && bcFields.length) {
        setting.addDropdown((d) => {
          if (allowNone) d.addOption('', '(none)');
          bcFields.forEach((f) => d.addOption(f, f));
          d.setValue(get()).onChange((v) => { set(v); save(); });
        });
      } else {
        setting.addText((t) => t.setValue(get()).onChange((v) => { set(v); save(); }));
      }
    };

    fieldSetting('Down field', 'Defines child notes.', () => s.breadcrumbDownField, (v) => { s.breadcrumbDownField = v || 'down'; });
    fieldSetting('Next field', 'Orders siblings via linked-list chain.', () => s.breadcrumbNextField, (v) => { s.breadcrumbNextField = v; }, true);
    this.tog(parent, 'Combine with body links', 'Merge body wikilinks into children.',
      () => s.breadcrumbCombineWithMoc, (v) => { s.breadcrumbCombineWithMoc = v; save(); });
    this.txt(parent, 'Include files matching', 'Substring filter on breadcrumb children.',
      'e.g. Beyond Good and Evil', () => s.includePattern, (v) => { s.includePattern = v; save(); });
    this.txt(parent, 'Max depth', '0 = unlimited.', '0',
      () => String(s.maxDepth), (v) => { s.maxDepth = Math.max(0, parseInt(v) || 0); save(); });
  }

  // ── Advanced settings ─────────────────────────────────────────────────────
  private renderAdvanced(parent: HTMLElement, save: () => void) {
    const s = this.plugin.settings;

    parent.createEl('p', { text: 'Structure', cls: 'bripey-advanced-group' });
    this.tog(parent, 'Adjust heading levels', 'Shift headings to nest under the containing heading.',
      () => s.adjustHeadingLevels, (v) => { s.adjustHeadingLevels = v; save(); });
    this.tog(parent, 'Skip Excalidraw embeds', 'Leave .excalidraw links as-is.',
      () => s.skipExcalidraw, (v) => { s.skipExcalidraw = v; save(); });
    this.tog(parent, 'Preserve inline links', 'Keep [[links]] without display text (citation-style).',
      () => s.preserveInlineLinks, (v) => { s.preserveInlineLinks = v; save(); });
    this.tog(parent, 'Bake links in lists', 'Also expand links that take up an entire list bullet.',
      () => s.bakeInList, (v) => { s.bakeInList = v; save(); });
    this.tog(parent, 'Bake file links', 'Convert ![[image.png]] to absolute file:// paths.',
      () => s.convertFileLinks, (v) => { s.convertFileLinks = v; save(); });
    this.tog(parent, 'Structured mode', 'Auto-inject headings for files that lack one; skip empty files.',
      () => s.structuredMode, (v) => { s.structuredMode = v; save(); });
    this.tog(parent, 'Review ambiguities', 'Walk through missing headings / empty files before baking.',
      () => s.reviewAmbiguities, (v) => { s.reviewAmbiguities = v; save(); });

    parent.createEl('p', { text: 'Cleanup', cls: 'bripey-advanced-group' });
    this.tog(parent, 'Strip comments', 'Remove %%...%% and <!-- --> blocks.',
      () => s.stripComments, (v) => { s.stripComments = v; save(); });
    this.tog(parent, 'Remove tasks', 'Strip - [ ] and - [x] lines.',
      () => s.removeTasks, (v) => { s.removeTasks = v; save(); });
    this.tog(parent, 'Remove tags', 'Strip #tags.',
      () => s.removeTags, (v) => { s.removeTags = v; save(); });
    this.tog(parent, 'Convert wikilinks to Markdown', 'Replace [[wikilinks]] with [text](file.md).',
      () => s.convertWikilinks, (v) => { s.convertWikilinks = v; save(); });
    new Setting(parent).setName('Dataview blocks').addDropdown((d) =>
      d.addOption('keep', 'Keep').addOption('strip', 'Strip').addOption('warn', 'Warn')
        .setValue(s.dataviewHandling)
        .onChange((v) => { s.dataviewHandling = v as typeof s.dataviewHandling; save(); })
    );

    parent.createEl('p', { text: 'Export', cls: 'bripey-advanced-group' });
    new Setting(parent).setName('Merge frontmatter fields')
      .setDesc('Comma-separated fields to collect from all files.')
      .addToggle((t) => t.setValue(s.mergeFrontmatter).onChange((v) => { s.mergeFrontmatter = v; save(); }))
      .addText((t) => t.setPlaceholder('tags').setValue(s.frontmatterMergeFields)
        .onChange((v) => { s.frontmatterMergeFields = v; save(); }));
    this.tog(parent, 'Export images to assets folder', 'Copy images and rewrite links to relative paths.',
      () => s.exportImages, (v) => { s.exportImages = v; save(); });
    this.txt(parent, 'Section separator', 'Text between sections (e.g. ---).', '---',
      () => s.sectionSeparator, (v) => { s.sectionSeparator = v; save(); });
    this.txt(parent, 'Header template', 'Note to prepend.', 'Templates/Header',
      () => s.headerTemplate, (v) => { s.headerTemplate = v; save(); });
    this.txt(parent, 'Footer template', 'Note to append.', 'Templates/Footer',
      () => s.footerTemplate, (v) => { s.footerTemplate = v; save(); });
  }

  // ── Output + action bar ────────────────────────────────────────────────────
  private renderActions(contentEl: HTMLElement, save: () => void) {
    const { settings } = this.plugin;
    new Setting(contentEl).setName('Output file name').then((setting) => {
      this.modalEl.createDiv('modal-button-container', (el) => {
        let outputName = this.file.basename + '.baked';
        let outputFolder = this.file.parent?.path ? this.file.parent.path + '/' : '';
        let watchAfterBake = false;

        new Setting(el).setName('Watch for changes')
          .addToggle((t) => t.setValue(false).onChange((v) => (watchAfterBake = v)));

        const executeBake = async () => {
          disableBtn(this.btn);
          if (!outputName) { enableBtn(this.btn); return; }

          // Build resolutions from excluded set
          let resolutions: ResolutionMap | undefined;
          if (this.excluded.size > 0) {
            resolutions = new Map();
            this.excluded.forEach((p) => resolutions!.set(p, { action: 'skip' }));
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
          if (existing instanceof TFile) await vault.modify(existing, baked);
          else existing = await vault.create(nextPath, baked);

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

          if (existing instanceof TFile) this.app.workspace.getLeaf('tab').openFile(existing);

          const warnings = runAllValidations(baked).filter(
            (w) => w.kind !== 'dataview-block' || settings.dataviewHandling === 'warn'
          );
          if (warnings.length > 0) { this.showWarnings(warnings.map((w) => w.message)); return; }
          this.close();
        };

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

  // ── Live preview ──────────────────────────────────────────────────────────
  private scheduleRefresh(delay = 400) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshPreview(), delay);
  }

  private async refreshPreview() {
    if (!this.previewEl) return;
    const { settings } = this.plugin;

    this.previewCountEl.setText('Loading…');
    this.previewEl.empty();

    let entries: DryRunEntry[];

    if (this.currentMode === 'link') {
      entries = [];
      await traceBake(this.app, this.file, new Set(), settings, 0, null, entries);
    } else {
      const tree = buildBreadcrumbTree(this.app, this.file, new Set(), settings);
      entries = flattenTree(tree).map((n) => ({ file: n.file, depth: n.depth, linkedBy: null }));
    }

    // Dedup
    const seen = new Set<string>();
    const unique = entries.filter((e) => {
      if (seen.has(e.file.path)) return false;
      seen.add(e.file.path);
      return true;
    });

    // Remove any excluded files that are no longer in the list
    for (const path of this.excluded) {
      if (!unique.some((e) => e.file.path === path)) this.excluded.delete(path);
    }

    const rootPath = this.file.path;

    const updateCount = () => {
      const included = unique.filter((e) => !this.excluded.has(e.file.path)).length;
      const totalSize = unique
        .filter((e) => !this.excluded.has(e.file.path))
        .reduce((s, e) => s + e.file.stat.size, 0);
      const estWords = Math.round(totalSize / 5).toLocaleString();
      this.previewCountEl.setText(`${included} / ${unique.length} files · ~${estWords} words`);
      if (this.btn) {
        if (included === 0) disableBtn(this.btn);
        else enableBtn(this.btn);
      }
    };

    for (const entry of unique) {
      const li = this.previewEl.createDiv('bripey-preview-entry');
      li.style.paddingLeft = `${entry.depth * 14}px`;

      const nameEl = li.createEl('span', {
        text: entry.file.basename,
        cls: 'bripey-preview-name',
      });

      const isRoot = entry.file.path === rootPath;
      if (isRoot) {
        li.createEl('span', { text: ' root', cls: 'bripey-preview-badge' });
      } else {
        if (this.excluded.has(entry.file.path)) li.addClass('bripey-excluded');
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');
        const toggle = () => {
          if (this.excluded.has(entry.file.path)) {
            this.excluded.delete(entry.file.path);
            li.removeClass('bripey-excluded');
          } else {
            this.excluded.add(entry.file.path);
            li.addClass('bripey-excluded');
          }
          updateCount();
        };
        li.addEventListener('click', toggle);
        li.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') toggle(); });
      }
    }

    updateCount();
  }

  // ── Warnings screen ────────────────────────────────────────────────────────
  private showWarnings(messages: string[]) {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Baked — warnings');
    contentEl.createEl('p', { text: 'The file was saved, but:' });
    const list = contentEl.createEl('ul');
    messages.forEach((msg) => list.createEl('li', { text: msg }));
    contentEl.createEl('p', { cls: 'mod-muted', text: 'Check source files for skipped heading levels, multiple H1s, or Dataview blocks.' });
    this.modalEl.createDiv('modal-button-container', (el) => {
      el.createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () => this.close());
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private tog(parent: HTMLElement, name: string, desc: string, get: () => boolean, set: (v: boolean) => void) {
    new Setting(parent).setName(name).setDesc(desc).addToggle((t) => t.setValue(get()).onChange((v) => set(v)));
  }

  private txt(parent: HTMLElement, name: string, desc: string, placeholder: string, get: () => string, set: (v: string) => void) {
    new Setting(parent).setName(name).setDesc(desc)
      .addText((t) => t.setPlaceholder(placeholder).setValue(get()).onChange((v) => set(v)));
  }
}
