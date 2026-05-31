import { Plugin } from 'obsidian';

import { BakeModal } from './BakeModal';
import { ProjectBakeModal } from './ProjectBakeModal';
import { EasyBakeApi } from './api';

export interface BakeSettings {
  bakeLinks: boolean;
  bakeEmbeds: boolean;
  bakeInList: boolean;
  convertFileLinks: boolean;
  adjustHeadingLevels: boolean;
  skipExcalidraw: boolean;
  preserveInlineLinks: boolean;
  removeTasks: boolean;
  removeTags: boolean;
  structuredMode: boolean;
}

const DEFAULT_SETTINGS: BakeSettings = {
  bakeLinks: true,
  bakeEmbeds: true,
  bakeInList: true,
  convertFileLinks: true,
  adjustHeadingLevels: true,
  skipExcalidraw: true,
  preserveInlineLinks: true,
  removeTasks: false,
  removeTags: false,
  structuredMode: false,
};

export default class EasyBake extends Plugin {
  settings: BakeSettings;

  public api = new EasyBakeApi(this);

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  get activeMarkdownFile() {
    return this.app.workspace.activeEditor?.file;
  }

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'bake-file',
      name: 'Bake current file',
      checkCallback: (checking) => {
        const file = this.activeMarkdownFile;
        if (checking || !file) return !!file;
        new BakeModal(this, file).open();
      },
    });

    this.addCommand({
      id: 'bake-project',
      name: 'Bake project',
      callback: () => {
        new ProjectBakeModal(this.app, this).open();
      },
    });
  }
}
