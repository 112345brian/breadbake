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
    private onProceed: () => void
  ) {
    super(app);
  }

  async onOpen() {
    this.titleEl.setText('Bake preview — dry run');
    const { contentEl } = this;
    contentEl.createEl('p', { text: 'Loading…', cls: 'mod-muted' });

    let entries: DryRunEntry[];

    if (this.mode === 'link' && this.rootFile) {
      entries = [];
      await traceBake(this.app, this.rootFile, new Set(), this.settings, 0, null, entries);
    } else if (this.mode === 'project' && this.scenes) {
      entries = this.scenes.map((s, i) => ({ file: s.file, depth: 0, linkedBy: null }));
    } else {
      entries = [];
    }

    contentEl.empty();

    // Dedup: a file may appear multiple times via different link paths — show first occurrence
    const seen = new Set<string>();
    const unique = entries.filter((e) => {
      if (seen.has(e.file.path)) return false;
      seen.add(e.file.path);
      return true;
    });

    contentEl.createEl('p', {
      text: `${unique.length} file${unique.length === 1 ? '' : 's'} would be included:`,
    });

    const list = contentEl.createEl('ul', { cls: 'bripey-dryrun-list' });
    let totalSize = 0;

    for (const entry of unique) {
      const indent = '  '.repeat(entry.depth);
      const li = list.createEl('li', { cls: 'bripey-dryrun-entry' });
      li.style.paddingLeft = `${entry.depth * 16}px`;

      li.createEl('span', { text: entry.file.basename, cls: 'bripey-scene-name' });

      if (entry.linkedBy) {
        li.createEl('span', {
          text: ` ← ${entry.linkedBy.basename}`,
          cls: 'mod-muted bripey-dryrun-via',
        });
      }

      totalSize += entry.file.stat.size;
    }

    const estWords = Math.round(totalSize / 5).toLocaleString();
    contentEl.createEl('p', {
      text: `Estimated word count: ~${estWords} words`,
      cls: 'mod-muted',
    });

    this.modalEl.createDiv('modal-button-container', (el) => {
      el.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
      el.createEl('button', { text: 'Proceed to bake', cls: 'mod-cta' }).addEventListener(
        'click',
        () => {
          this.close();
          this.onProceed();
        }
      );
    });
  }
}
