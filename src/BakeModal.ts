import { Modal, Setting, TFile } from 'obsidian';

import { bake } from './bake';
import EasyBake from './main';
import { getWordCount } from './util';

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
      .setName('Structured mode')
      .setDesc(
        'Resolve ambiguous structure: inject a heading for any embedded file that lacks one (using its frontmatter title or filename), and skip files that are empty after processing.'
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.structuredMode).onChange((value) => {
          settings.structuredMode = value;
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

        const btn = el.createEl('button', {
          cls: 'mod-cta',
          text: 'Bake',
        });

        activeWindow.setTimeout(() => {
          // Set focus so users can quickly press enter
          btn.focus();
        });

        btn.addEventListener('click', async () => {
          disableBtn(btn);
          if (outputName) {
            const { vault } = this.app;
            const baked = await bake(this.app, file, null, new Set(), settings);
            const nextPath = outputFolder + outputName + '.md';
            let existing = vault.getAbstractFileByPath(nextPath);

            if (existing instanceof TFile) {
              await vault.modify(existing, baked);
            } else {
              existing = await vault.create(nextPath, baked);
            }

            if (existing instanceof TFile) {
              this.app.workspace.getLeaf('tab').openFile(existing);
            }
          }

          this.close();
        });

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
}
