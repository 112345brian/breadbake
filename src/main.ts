import { Notice, Plugin } from 'obsidian';

import { BakeModal } from './BakeModal';
import { ProjectBakeModal } from './ProjectBakeModal';
import { BreadcrumbBakeModal } from './BreadcrumbBakeModal';
import { WatchManager } from './watcher';
import { EasyBakeApi } from './api';
import { BreadBakeSettingsTab } from './SettingsTab';

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
  breadcrumbNextField: string;
  breadcrumbCombineWithMoc: boolean;
  sectionSeparator: string;
  dataviewHandling: 'keep' | 'strip' | 'warn';
  headerTemplate: string;
  footerTemplate: string;
  maxDepth: number;
  includePattern: string;
  excludePattern: string;
  bakeMode: 'link' | 'breadcrumb' | 'outline';
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
  breadcrumbNextField: 'next',
  breadcrumbCombineWithMoc: false,
  sectionSeparator: '',
  dataviewHandling: 'warn',
  headerTemplate: '',
  footerTemplate: '',
  maxDepth: 0,
  includePattern: '',
  excludePattern: '',
  bakeMode: 'link',
};

export default class EasyBake extends Plugin {
  settings: BakeSettings;
  watcher: WatchManager;
  public api: EasyBakeApi;

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  get activeMarkdownFile() {
    return this.app.workspace.activeEditor?.file;
  }

  onunload() {
    this.watcher?.unload();
  }

  async onload() {
    await this.loadSettings();
    this.api = new EasyBakeApi(this);
    this.watcher = new WatchManager(this.app);
    this.addSettingTab(new BreadBakeSettingsTab(this.app, this));

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

    this.addCommand({
      id: 'stop-watching',
      name: 'Stop watching (all)',
      callback: () => {
        const watched = this.watcher.list();
        if (watched.length === 0) {
          new Notice('No active watches.');
          return;
        }
        this.watcher.removeAll();
      },
    });
  }
}
