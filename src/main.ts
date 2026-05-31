import { Plugin } from 'obsidian';

import { BakeModal } from './BakeModal';
import { ProjectBakeModal } from './ProjectBakeModal';
import { BreadcrumbBakeModal } from './BreadcrumbBakeModal';
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
  reviewAmbiguities: boolean;
  mocMode: boolean;
  stripComments: boolean;
  convertWikilinks: boolean;
  mergeFrontmatter: boolean;
  frontmatterMergeFields: string;
  exportImages: boolean;
  breadcrumbDownField: string;
  breadcrumbCombineWithMoc: boolean;
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
  reviewAmbiguities: false,
  mocMode: false,
  stripComments: false,
  convertWikilinks: false,
  mergeFrontmatter: false,
  frontmatterMergeFields: 'tags',
  exportImages: false,
  breadcrumbDownField: 'down',
  breadcrumbCombineWithMoc: false,
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

    this.addCommand({
      id: 'bake-breadcrumbs',
      name: 'Bake from breadcrumbs',
      checkCallback: (checking) => {
        const file = this.activeMarkdownFile;
        if (checking || !file) return !!file;
        new BreadcrumbBakeModal(this.app, file, this.settings, this).open();
      },
    });
  }
}
