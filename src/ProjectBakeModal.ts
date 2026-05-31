import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { BakeSettings } from './main';
import EasyBake from './main';
import { ProjectScene, bakeProject, getKnownProjects, getProjectScenes, writeSceneOrders } from './bakeProject';
import { AmbiguityModal } from './AmbiguityModal';
import { ResolutionMap, autoResolve, detectAmbiguities } from './ambiguity';
import { DryRunModal } from './DryRunModal';
import { exportImages } from './imageExport';
import { applyTemplates } from './watcher';
import { getWordCount, mergeTagsIntoFrontmatter } from './util';
import { runAllValidations } from './validate';

export class ProjectBakeModal extends Modal {
  constructor(app: App, private plugin: EasyBake) {
    super(app);

    const { settings } = plugin;
    this.titleEl.setText('Bake project');
    this.modalEl.addClass('mod-narrow', 'easy-bake-modal');

    const projects = getKnownProjects(app);

    if (projects.length === 0) {
      this.contentEl.createEl('p', {
        text: 'No projects found. Add bake-project: "My Project" to a note\'s frontmatter to get started.',
      });
      return;
    }

    let selectedProject = projects[0];
    let scenes: ProjectScene[] = getProjectScenes(app, selectedProject);

    // --- Project picker ---
    new Setting(this.contentEl)
      .setName('Project')
      .addDropdown((drop) => {
        projects.forEach((p) => drop.addOption(p, p));
        drop.setValue(selectedProject).onChange((val) => {
          selectedProject = val;
          scenes = getProjectScenes(app, val);
          refreshSceneList();
        });
      });

    // --- Scene order list ---
    const sceneListEl = this.contentEl.createDiv('bripey-scene-list');

    const refreshSceneList = () => {
      sceneListEl.empty();

      if (scenes.length === 0) {
        sceneListEl.createEl('p', { text: 'No scenes found for this project.' });
        return;
      }

      const unordered = scenes.filter((s) => !s.hasOrder);
      if (unordered.length > 0) {
        sceneListEl.createEl('p', {
          text: `${unordered.length} scene(s) have no bake-order and will appear at the end. Reorder below to assign positions.`,
          cls: 'mod-warning',
        });
      }

      scenes.forEach((scene, i) => {
        const row = sceneListEl.createDiv('bripey-scene-row');
        row.createEl('span', { text: scene.file.basename, cls: 'bripey-scene-name' });

        const btnWrap = row.createDiv('bripey-scene-btns');

        const upBtn = btnWrap.createEl('button', { text: '↑' });
        upBtn.disabled = i === 0;
        upBtn.addEventListener('click', () => {
          [scenes[i - 1], scenes[i]] = [scenes[i], scenes[i - 1]];
          refreshSceneList();
        });

        const downBtn = btnWrap.createEl('button', { text: '↓' });
        downBtn.disabled = i === scenes.length - 1;
        downBtn.addEventListener('click', () => {
          [scenes[i], scenes[i + 1]] = [scenes[i + 1], scenes[i]];
          refreshSceneList();
        });
      });
    };

    refreshSceneList();

    // --- Word count ---
    new Setting(this.contentEl).then((setting) => {
      setting.addButton((btn) =>
        btn.setButtonText('Calculate word count').onClick(async () => {
          const baked = await bakeProject(app, scenes, settings);
          setting.descEl.setText(`${getWordCount(baked).toLocaleString()} words`);
        })
      );
    });

    // --- Bake button ---
    this.modalEl.createDiv('modal-button-container', (el) => {
      const currentFile = app.workspace.activeEditor?.file;
      const defaultName = selectedProject.toLowerCase().replace(/\s+/g, '-') + '.baked';
      let outputName = defaultName;

      let watchAfterBake = false;
      new Setting(el)
        .setName('Watch for changes')
        .setDesc('Automatically rebake when source files are modified.')
        .addToggle((t) => t.setValue(false).onChange((v) => (watchAfterBake = v)));

      // --- Dry run ---
      el.createEl('button', { text: 'Dry run' }).addEventListener('click', () => {
        new DryRunModal(app, 'project', null, scenes, settings, () => {}).open();
      });

      // --- Copy to clipboard ---
      el.createEl('button', { text: 'Copy to clipboard' }).addEventListener('click', async () => {
        const baked = await bakeProject(app, scenes, settings);
        await navigator.clipboard.writeText(baked);
        new Notice('Baked project copied to clipboard.');
        this.close();
      });

      const btn = el.createEl('button', { cls: 'mod-cta', text: 'Bake' });

      activeWindow.setTimeout(() => btn.focus());

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.removeClass('mod-cta');
        btn.addClass('mod-muted');

        // Write bake-order back to frontmatter for any reordering done in the modal
        await writeSceneOrders(app, selectedProject, scenes);

        let resolutions: ResolutionMap | undefined;

        if (settings.reviewAmbiguities) {
          const ambiguities = detectAmbiguities(app, scenes.map((s) => s.file));
          if (ambiguities.length > 0) {
            resolutions = await new Promise<ResolutionMap | null>((res) =>
              new AmbiguityModal(app, ambiguities, res).open()
            ) ?? undefined;
            if (!resolutions) {
              btn.disabled = false;
              btn.removeClass('mod-muted');
              btn.addClass('mod-cta');
              return;
            }
          }
        } else if (settings.structuredMode) {
          const ambiguities = detectAmbiguities(app, scenes.map((s) => s.file));
          resolutions = autoResolve(ambiguities);
        }

        let baked = await bakeProject(app, scenes, settings, resolutions);
        // Frontmatter merging
        if (settings.mergeFrontmatter) {
          const fields = settings.frontmatterMergeFields.split(',').map((f) => f.trim()).filter(Boolean);
          for (const field of fields) {
            const tagSets = scenes.map((s) => {
              const val = app.metadataCache.getFileCache(s.file)?.frontmatter?.[field];
              if (!val) return [];
              return Array.isArray(val) ? val.map(String) : [String(val)];
            });
            if (field === 'tags') baked = mergeTagsIntoFrontmatter(baked, tagSets);
          }
        }

        const folderPath = currentFile?.parent?.path ?? '';
        const folder = folderPath ? folderPath + '/' : '';
        const nextPath = folder + outputName + '.md';
        const { vault } = app;
        let existing = vault.getAbstractFileByPath(nextPath);

        if (existing instanceof TFile) {
          await vault.modify(existing, baked);
        } else {
          existing = await vault.create(nextPath, baked);
        }

        // Template injection
        baked = await applyTemplates(app, baked, settings);

        // Image export
        if (settings.exportImages && existing instanceof TFile) {
          baked = await exportImages(app, baked, existing.parent?.path ?? '', outputName);
          await vault.modify(existing, baked);
        }

        if (existing instanceof TFile) {
          app.workspace.getLeaf('tab').openFile(existing);
        }

        if (watchAfterBake && existing instanceof TFile) {
          const sourceFiles = new Set(scenes.map((s) => s.file));
          this.plugin.watcher.add(
            { outputPath: nextPath, mode: 'project', projectName: selectedProject, settings: { ...settings } },
            sourceFiles
          );
        }

        const warnings = runAllValidations(baked).filter(
          (w) => w.kind !== 'dataview-block' || settings.dataviewHandling === 'warn'
        );
        if (warnings.length > 0) {
          this.contentEl.empty();
          this.titleEl.setText('Baked — warnings');
          this.contentEl.createEl('p', { text: 'The baked file was saved with the following warnings:' });
          const list = this.contentEl.createEl('ul');
          warnings.forEach((w) => list.createEl('li', { text: w.message }));
          this.modalEl.createDiv('modal-button-container', (el2) => {
            el2.createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () => this.close());
          });
          return;
        }

        this.close();
      });

      new Setting(el).addText((text) =>
        text.setValue(outputName).onChange((val) => {
          outputName = val;
          btn.disabled = !val;
        })
      );
    });
  }
}
