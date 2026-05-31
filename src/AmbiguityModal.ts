import { App, Modal, Setting } from 'obsidian';
import { Ambiguity, Resolution, ResolutionMap } from './ambiguity';

const KIND_LABEL: Record<string, string> = {
  'no-heading': 'No heading found',
  'empty-file': 'File is empty',
};

const KIND_DESC: Record<string, string> = {
  'no-heading': 'This file has no H1. What should be used as its heading in the output?',
  'empty-file': 'This file has no content after processing. Include it anyway or skip it?',
};

export class AmbiguityModal extends Modal {
  private resolutions: ResolutionMap = new Map();
  private resolve: (map: ResolutionMap | null) => void;

  constructor(
    app: App,
    private ambiguities: Ambiguity[],
    onDone: (map: ResolutionMap | null) => void
  ) {
    super(app);
    this.resolve = onDone;
  }

  onOpen() {
    this.render(0);
  }

  onClose() {
    // If closed before finishing, treat as cancel
    if (this.resolutions.size < this.ambiguities.length) {
      this.resolve(null);
    }
  }

  private render(index: number) {
    const { contentEl, ambiguities } = this;
    contentEl.empty();

    if (index >= ambiguities.length) {
      this.resolve(this.resolutions);
      this.close();
      return;
    }

    const a = ambiguities[index];
    const remaining = ambiguities.length - index;

    this.titleEl.setText(`Resolve ambiguity (${index + 1} of ${ambiguities.length})`);

    contentEl.createEl('p', { cls: 'mod-warning', text: KIND_LABEL[a.kind] });
    contentEl
      .createEl('p', { text: 'File: ' })
      .createEl('strong', { text: a.file.path });
    contentEl.createEl('p', { text: KIND_DESC[a.kind] });

    const applyToAll = { value: false };

    if (a.kind === 'no-heading') {
      let title = a.suggestion ?? a.file.basename;

      new Setting(contentEl)
        .setName('Heading text')
        .addText((t) => t.setValue(title).onChange((v) => (title = v)));

      new Setting(contentEl)
        .setName('Apply this choice to all remaining "no heading" files')
        .addToggle((t) => t.setValue(false).onChange((v) => (applyToAll.value = v)));

      this.modalEl.createDiv('modal-button-container', (el) => {
        el.createEl('button', { text: 'Skip file', cls: 'mod-warning' }).addEventListener(
          'click',
          () => {
            this.applyResolution(index, { action: 'skip' }, applyToAll.value, 'no-heading');
            this.render(this.resolutions.size < ambiguities.length ? index + 1 : ambiguities.length);
          }
        );
        el.createEl('button', { text: 'Use heading', cls: 'mod-cta' }).addEventListener(
          'click',
          () => {
            this.applyResolution(
              index,
              { action: 'inject-heading', title },
              applyToAll.value,
              'no-heading'
            );
            this.render(index + 1);
          }
        );
      });
    } else if (a.kind === 'empty-file') {
      new Setting(contentEl)
        .setName('Apply this choice to all remaining empty files')
        .addToggle((t) => t.setValue(false).onChange((v) => (applyToAll.value = v)));

      this.modalEl.createDiv('modal-button-container', (el) => {
        el.createEl('button', { text: 'Include anyway' }).addEventListener('click', () => {
          this.applyResolution(index, { action: 'include' }, applyToAll.value, 'empty-file');
          this.render(index + 1);
        });
        el.createEl('button', { text: 'Skip file', cls: 'mod-cta' }).addEventListener(
          'click',
          () => {
            this.applyResolution(index, { action: 'skip' }, applyToAll.value, 'empty-file');
            this.render(index + 1);
          }
        );
      });
    }

    // Auto-resolve remaining shortcut
    if (remaining > 1) {
      contentEl.createEl('p').createEl('a', {
        text: `Auto-resolve remaining ${remaining - 1} ambiguities`,
        href: '#',
      }).addEventListener('click', (e) => {
        e.preventDefault();
        for (let i = index; i < ambiguities.length; i++) {
          const amb = ambiguities[i];
          if (!this.resolutions.has(amb.file.path)) {
            const res: Resolution =
              amb.kind === 'empty-file'
                ? { action: 'skip' }
                : { action: 'inject-heading', title: amb.suggestion ?? amb.file.basename };
            this.resolutions.set(amb.file.path, res);
          }
        }
        this.resolve(this.resolutions);
        this.close();
      });
    }
  }

  private applyResolution(
    index: number,
    resolution: Resolution,
    applyToAll: boolean,
    kind: string
  ) {
    const { ambiguities } = this;
    this.resolutions.set(ambiguities[index].file.path, resolution);

    if (applyToAll) {
      for (let i = index + 1; i < ambiguities.length; i++) {
        const a = ambiguities[i];
        if (a.kind === kind && !this.resolutions.has(a.file.path)) {
          if (resolution.action === 'inject-heading') {
            // Use each file's own suggestion rather than copying the chosen title
            this.resolutions.set(a.file.path, {
              action: 'inject-heading',
              title: a.suggestion ?? a.file.basename,
            });
          } else {
            this.resolutions.set(a.file.path, resolution);
          }
        }
      }
    }
  }
}
