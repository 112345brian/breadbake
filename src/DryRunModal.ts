import { App, Modal, TFile } from 'obsidian';
import { BakeSettings } from './main';
import { DryRunEntry, traceBake } from './dryRun';
import { ProjectScene } from './bakeProject';

export class DryRunModal extends Modal {
  constructor(
    app: App,
    private mode: 'link' | 'project',
    private rootFile: TFile | null,
    private scenes: ProjectScene[] | null,
    private settings: BakeSettings,
    private onProceed: (excluded: Set<string>) => void
  ) {
    super(app);
  }

  async onOpen() {
    this.titleEl.setText('Bake preview');
    const { contentEl } = this;
    contentEl.createEl('p', { text: 'Loading…', cls: 'mod-muted' });

    let entries: DryRunEntry[];

    if (this.mode === 'link' && this.rootFile) {
      entries = [];
      await traceBake(this.app, this.rootFile, new Set(), this.settings, 0, null, entries);
    } else if (this.mode === 'project' && this.scenes) {
      entries = this.scenes.map((s) => ({ file: s.file, depth: 0, linkedBy: null }));
    } else {
      entries = [];
    }

    contentEl.empty();

    // Dedup — show first occurrence when a file appears via multiple paths
    const seen = new Set<string>();
    const unique = entries.filter((e) => {
      if (seen.has(e.file.path)) return false;
      seen.add(e.file.path);
      return true;
    });

    // Skip the root file itself from the toggle list (always included)
    const rootPath = this.rootFile?.path ?? null;

    const excluded = new Set<string>();

    const totalSize = unique.reduce((sum, e) => sum + e.file.stat.size, 0);
    const estWords = () =>
      Math.round(
        unique.filter((e) => !excluded.has(e.file.path)).reduce((s, e) => s + e.file.stat.size, 0) / 5
      ).toLocaleString();

    const headerEl = contentEl.createEl('p');
    const updateHeader = () => {
      const included = unique.length - excluded.size;
      headerEl.setText(
        `${included} of ${unique.length} file${unique.length === 1 ? '' : 's'} selected — click to toggle`
      );
    };
    updateHeader();

    contentEl.createEl('p', { text: 'Click a file to exclude it from the bake.', cls: 'mod-muted' });

    const list = contentEl.createEl('ul', { cls: 'bripey-dryrun-list' });

    const wordCountEl = contentEl.createEl('p', { cls: 'mod-muted' });
    const updateWordCount = () => {
      wordCountEl.setText(`Estimated word count: ~${estWords()} words`);
    };
    updateWordCount();

    // Build bake button reference early so we can update its label
    let bakeBtn: HTMLButtonElement;

    const updateBakeBtn = () => {
      if (!bakeBtn) return;
      const included = unique.length - excluded.size;
      bakeBtn.setText(`Bake (${included} file${included === 1 ? '' : 's'})`);
      bakeBtn.disabled = included === 0;
    };

    for (const entry of unique) {
      const li = list.createEl('li', { cls: 'bripey-dryrun-entry' });
      li.style.paddingLeft = `${entry.depth * 16}px`;
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');

      const nameEl = li.createEl('span', { text: entry.file.basename, cls: 'bripey-scene-name' });

      if (entry.linkedBy) {
        li.createEl('span', {
          text: ` ← ${entry.linkedBy.basename}`,
          cls: 'mod-muted bripey-dryrun-via',
        });
      }

      // Root file is not toggleable
      const isRoot = entry.file.path === rootPath;
      if (isRoot) {
        li.createEl('span', { text: ' (root)', cls: 'mod-muted' });
        li.style.opacity = '0.6';
      } else {
        const toggle = () => {
          if (excluded.has(entry.file.path)) {
            excluded.delete(entry.file.path);
            li.removeClass('bripey-excluded');
          } else {
            excluded.add(entry.file.path);
            li.addClass('bripey-excluded');
          }
          updateHeader();
          updateWordCount();
          updateBakeBtn();
        };
        li.addEventListener('click', toggle);
        li.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') toggle(); });
      }
    }

    this.modalEl.createDiv('modal-button-container', (el) => {
      el.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());

      bakeBtn = el.createEl('button', { cls: 'mod-cta' }) as HTMLButtonElement;
      updateBakeBtn();
      bakeBtn.addEventListener('click', () => {
        this.close();
        this.onProceed(excluded);
      });
    });
  }
}
