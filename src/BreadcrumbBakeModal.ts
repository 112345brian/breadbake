import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { BakeSettings } from './main';
import { BreadcrumbNode, bakeBreadcrumbTree, buildBreadcrumbTree, flattenTree } from './breadcrumbs';
import { detectAmbiguities, autoResolve, ResolutionMap } from './ambiguity';
import { AmbiguityModal } from './AmbiguityModal';
import { exportImages } from './imageExport';
import { mergeTagsIntoFrontmatter } from './util';
import { validateHeadings } from './validate';

export class BreadcrumbBakeModal extends Modal {
  private root: BreadcrumbNode;

  constructor(
    app: App,
    private file: TFile,
    private settings: BakeSettings,
    private plugin: { saveSettings(): Promise<void> }
  ) {
    super(app);
    this.root = buildBreadcrumbTree(app, file, new Set(), settings);
  }

  onOpen() {
    this.renderPreview();
  }

  private renderPreview() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Bake from breadcrumbs');

    const flat = flattenTree(this.root);
    const nodeCount = flat.length;

    if (nodeCount <= 1 && this.root.children.length === 0) {
      contentEl.createEl('p', {
        text: `No '${this.settings.breadcrumbDownField}' links found in frontmatter.`,
        cls: 'mod-warning',
      });
      contentEl.createEl('p', {
        cls: 'mod-muted',
        text: `Add ${this.settings.breadcrumbDownField}: [[Child Note]] to this file's frontmatter to define the structure.`,
      });

      if (this.settings.breadcrumbCombineWithMoc) {
        contentEl.createEl('p', {
          cls: 'mod-muted',
          text: 'Combination mode is on — body links were also checked but none were found.',
        });
      }

      this.modalEl.createDiv('modal-button-container', (el) => {
        el.createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () =>
          this.close()
        );
      });
      return;
    }

    contentEl.createEl('p', {
      text: `Found ${nodeCount} file${nodeCount === 1 ? '' : 's'} via '${this.settings.breadcrumbDownField}':`,
    });

    const tree = contentEl.createEl('ul', { cls: 'bripey-bc-tree' });
    this.renderNode(tree, this.root);

    // Settings
    new Setting(contentEl)
      .setName('Down field')
      .setDesc('Frontmatter key used to find children.')
      .addText((t) =>
        t
          .setValue(this.settings.breadcrumbDownField)
          .onChange((v) => {
            this.settings.breadcrumbDownField = v.trim() || 'down';
            this.plugin.saveSettings();
            // Rebuild tree and re-render
            this.root = buildBreadcrumbTree(this.app, this.file, new Set(), this.settings);
            this.renderPreview();
          })
      );

    new Setting(contentEl)
      .setName('Combine with body links')
      .setDesc('Also include wikilinks found in the file body, merged with frontmatter children.')
      .addToggle((t) =>
        t.setValue(this.settings.breadcrumbCombineWithMoc).onChange((v) => {
          this.settings.breadcrumbCombineWithMoc = v;
          this.plugin.saveSettings();
          this.root = buildBreadcrumbTree(this.app, this.file, new Set(), this.settings);
          this.renderPreview();
        })
      );

    this.modalEl.createDiv('modal-button-container', (el) => {
      let outputName = this.file.basename + '.baked';
      const outputFolder = this.file.parent?.path ? this.file.parent.path + '/' : '';

      el.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());

      el.createEl('button', { text: 'Copy to clipboard' }).addEventListener('click', async () => {
        const baked = await bakeBreadcrumbTree(this.app, this.root, this.settings);
        await navigator.clipboard.writeText(baked);
        new Notice('Breadcrumb bake copied to clipboard.');
        this.close();
      });

      const btn = el.createEl('button', { cls: 'mod-cta', text: 'Bake' });
      activeWindow.setTimeout(() => btn.focus());

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.removeClass('mod-cta');
        btn.addClass('mod-muted');

        let resolutions: ResolutionMap | undefined;

        if (this.settings.reviewAmbiguities) {
          const allFiles = flattenTree(this.root).map((n) => n.file);
          const ambiguities = detectAmbiguities(this.app, allFiles);
          if (ambiguities.length > 0) {
            resolutions = await new Promise<ResolutionMap | null>((res) =>
              new AmbiguityModal(this.app, ambiguities, res).open()
            ) ?? undefined;
            if (!resolutions) {
              btn.disabled = false;
              btn.removeClass('mod-muted');
              btn.addClass('mod-cta');
              return;
            }
          }
        } else if (this.settings.structuredMode) {
          const allFiles = flattenTree(this.root).map((n) => n.file);
          resolutions = autoResolve(detectAmbiguities(this.app, allFiles));
        }

        let baked = await bakeBreadcrumbTree(this.app, this.root, this.settings, resolutions);

        // Frontmatter merging
        if (this.settings.mergeFrontmatter) {
          const fields = this.settings.frontmatterMergeFields
            .split(',').map((f) => f.trim()).filter(Boolean);
          const allFiles = flattenTree(this.root).map((n) => n.file);
          for (const field of fields) {
            const tagSets = allFiles.map((f) => {
              const val = this.app.metadataCache.getFileCache(f)?.frontmatter?.[field];
              if (!val) return [];
              return Array.isArray(val) ? val.map(String) : [String(val)];
            });
            if (field === 'tags') baked = mergeTagsIntoFrontmatter(baked, tagSets);
          }
        }

        const nextPath = outputFolder + outputName + '.md';
        const { vault } = this.app;
        let existing = vault.getAbstractFileByPath(nextPath);
        if (existing instanceof TFile) {
          await vault.modify(existing, baked);
        } else {
          existing = await vault.create(nextPath, baked);
        }

        if (this.settings.exportImages && existing instanceof TFile) {
          baked = await exportImages(this.app, baked, existing.parent?.path ?? '', outputName);
          await vault.modify(existing, baked);
        }

        if (existing instanceof TFile) {
          this.app.workspace.getLeaf('tab').openFile(existing);
        }

        const warnings = validateHeadings(baked);
        if (warnings.length > 0) {
          contentEl.empty();
          this.titleEl.setText('Baked — heading warnings');
          contentEl.createEl('p', { text: 'The baked file was saved, but the heading structure may not be idiomatic:' });
          const list = contentEl.createEl('ul');
          warnings.forEach((w) => list.createEl('li', { text: w.message }));
          this.modalEl.createDiv('modal-button-container', (el2) =>
            el2.createEl('button', { text: 'Close', cls: 'mod-cta' })
               .addEventListener('click', () => this.close())
          );
          return;
        }

        this.close();
      });

      new Setting(el).addText((text) =>
        text.setValue(outputName).onChange((v) => {
          outputName = v;
          btn.disabled = !v;
        })
      );
    });
  }

  private renderNode(parent: HTMLElement, node: BreadcrumbNode) {
    const li = parent.createEl('li', { cls: 'bripey-bc-node' });
    li.style.paddingLeft = `${node.depth * 16}px`;

    const label = li.createSpan({ cls: 'bripey-scene-name' });
    if (node.depth === 0) {
      label.setText(`📄 ${node.file.basename} (root)`);
    } else {
      const levelBadge = li.createEl('span', {
        text: `H${Math.min(node.depth + 1, 6)}`,
        cls: 'bripey-bc-level',
      });
      label.setText(` ${node.file.basename}`);
      li.prepend(levelBadge);
    }

    if (node.children.length > 0) {
      const childList = li.createEl('ul');
      node.children.forEach((child) => this.renderNode(childList, child));
    }
  }
}
