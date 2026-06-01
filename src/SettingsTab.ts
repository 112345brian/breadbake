import { App, PluginSettingTab, Setting } from 'obsidian';
import EasyBake from './main';

export class BreadBakeSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: EasyBake) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const { settings } = this.plugin;
    const save = () => this.plugin.saveSettings();

    containerEl.empty();
    containerEl.createEl('p', {
      text: 'These are the defaults used when you open the bake modal. All settings can also be changed per-bake inside the modal.',
      cls: 'setting-item-description',
    });

    // ── Default mode ──────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Default bake mode' });

    new Setting(containerEl)
      .setName('Default mode')
      .setDesc('Which tab is selected when the bake modal opens.')
      .addDropdown((d) =>
        d
          .addOption('link', 'Link bake')
          .addOption('breadcrumb', 'Breadcrumbs')
          .addOption('outline', 'Outline')
          .setValue(settings.bakeMode)
          .onChange((v) => { settings.bakeMode = v as typeof settings.bakeMode; save(); })
      );

    // ── Scope ─────────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Scope' });

    new Setting(containerEl)
      .setName('Max depth')
      .setDesc('How many levels of links to follow. 0 = unlimited.')
      .addText((t) =>
        t.setValue(String(settings.maxDepth)).onChange((v) => {
          settings.maxDepth = Math.max(0, parseInt(v) || 0);
          save();
        })
      );

    new Setting(containerEl)
      .setName('Include files matching')
      .setDesc('Only follow links to files whose path contains this string.')
      .addText((t) =>
        t.setPlaceholder('e.g. Beyond Good and Evil').setValue(settings.includePattern)
          .onChange((v) => { settings.includePattern = v; save(); })
      );

    new Setting(containerEl)
      .setName('Exclude files matching')
      .setDesc('Skip links to files whose path contains this string.')
      .addText((t) =>
        t.setPlaceholder('e.g. /people/').setValue(settings.excludePattern)
          .onChange((v) => { settings.excludePattern = v; save(); })
      );

    // ── Breadcrumbs ───────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Breadcrumbs' });

    new Setting(containerEl)
      .setName('Down field')
      .setDesc('Frontmatter field used to find child notes.')
      .addText((t) =>
        t.setValue(settings.breadcrumbDownField)
          .onChange((v) => { settings.breadcrumbDownField = v || 'down'; save(); })
      );

    new Setting(containerEl)
      .setName('Next field')
      .setDesc('Frontmatter field used to order siblings.')
      .addText((t) =>
        t.setValue(settings.breadcrumbNextField)
          .onChange((v) => { settings.breadcrumbNextField = v; save(); })
      );

    // ── Structure ─────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Structure' });

    new Setting(containerEl)
      .setName('Adjust heading levels')
      .setDesc('Shift headings in embedded files to nest under the containing heading.')
      .addToggle((t) => t.setValue(settings.adjustHeadingLevels)
        .onChange((v) => { settings.adjustHeadingLevels = v; save(); }));

    new Setting(containerEl)
      .setName('Structured mode')
      .setDesc('Auto-inject headings for files that lack one; skip empty files.')
      .addToggle((t) => t.setValue(settings.structuredMode)
        .onChange((v) => { settings.structuredMode = v; save(); }));

    new Setting(containerEl)
      .setName('Map of contents mode')
      .setDesc('Treat bulleted wikilinks as a document outline — bullet depth → heading level.')
      .addToggle((t) => t.setValue(settings.mocMode)
        .onChange((v) => { settings.mocMode = v; save(); }));

    // ── Cleanup ───────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Cleanup' });

    new Setting(containerEl)
      .setName('Strip comments')
      .setDesc('Remove %%comment%% and <!-- --> blocks.')
      .addToggle((t) => t.setValue(settings.stripComments)
        .onChange((v) => { settings.stripComments = v; save(); }));

    new Setting(containerEl)
      .setName('Remove tasks')
      .setDesc('Strip - [ ] and - [x] lines.')
      .addToggle((t) => t.setValue(settings.removeTasks)
        .onChange((v) => { settings.removeTasks = v; save(); }));

    new Setting(containerEl)
      .setName('Remove tags')
      .setDesc('Strip #tags.')
      .addToggle((t) => t.setValue(settings.removeTags)
        .onChange((v) => { settings.removeTags = v; save(); }));

    new Setting(containerEl)
      .setName('Convert wikilinks to Markdown links')
      .setDesc('Replace [[wikilinks]] with standard [text](file.md) links.')
      .addToggle((t) => t.setValue(settings.convertWikilinks)
        .onChange((v) => { settings.convertWikilinks = v; save(); }));

    new Setting(containerEl)
      .setName('Dataview blocks')
      .addDropdown((d) =>
        d.addOption('keep', 'Keep').addOption('strip', 'Strip').addOption('warn', 'Warn after baking')
          .setValue(settings.dataviewHandling)
          .onChange((v) => { settings.dataviewHandling = v as typeof settings.dataviewHandling; save(); })
      );

    // ── Export ────────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Export' });

    new Setting(containerEl)
      .setName('Section separator')
      .setDesc('Text inserted between baked sections (e.g. ---). Empty = none.')
      .addText((t) =>
        t.setPlaceholder('---').setValue(settings.sectionSeparator)
          .onChange((v) => { settings.sectionSeparator = v; save(); })
      );

    new Setting(containerEl)
      .setName('Export images to assets folder')
      .setDesc('Copy images to {name}_assets/ and rewrite links to relative paths.')
      .addToggle((t) => t.setValue(settings.exportImages)
        .onChange((v) => { settings.exportImages = v; save(); }));

    new Setting(containerEl)
      .setName('Merge frontmatter fields')
      .setDesc('Comma-separated fields to collect from all included files.')
      .addToggle((t) => t.setValue(settings.mergeFrontmatter)
        .onChange((v) => { settings.mergeFrontmatter = v; save(); }))
      .addText((t) =>
        t.setPlaceholder('tags').setValue(settings.frontmatterMergeFields)
          .onChange((v) => { settings.frontmatterMergeFields = v; save(); })
      );
  }
}
