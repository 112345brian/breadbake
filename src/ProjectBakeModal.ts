import { App, Modal, Setting, TFile } from 'obsidian';
import { BakeSettings } from './main';
import { ProjectScene, bakeProject, getKnownProjects, getProjectScenes, writeSceneOrders } from './bakeProject';
import { AmbiguityModal } from './AmbiguityModal';
import { ResolutionMap, autoResolve, detectAmbiguities } from './ambiguity';
import { getWordCount } from './util';
import { validateHeadings } from './validate';

export class ProjectBakeModal extends Modal {
  constructor(app: App, plugin: { settings: BakeSettings; saveSettings(): Promise<void> }) {
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

        const baked = await bakeProject(app, scenes, settings, resolutions);
        const folder = currentFile?.parent?.path ? currentFile.parent.path + '/' : '';
        const nextPath = folder + outputName + '.md';
        const { vault } = app;
        let existing = vault.getAbstractFileByPath(nextPath);

        if (existing instanceof TFile) {
          await vault.modify(existing, baked);
        } else {
          existing = await vault.create(nextPath, baked);
        }

        if (existing instanceof TFile) {
          app.workspace.getLeaf('tab').openFile(existing);
        }

        const warnings = validateHeadings(baked);
        if (warnings.length > 0) {
          this.contentEl.empty();
          this.titleEl.setText('Baked — heading warnings');
          this.contentEl.createEl('p', { text: 'The baked file was saved, but the heading structure may not be idiomatic:' });
          const list = this.contentEl.createEl('ul');
          warnings.forEach((w) => list.createEl('li', { text: w.message }));
          this.contentEl.createEl('p', {
            cls: 'mod-muted',
            text: 'Check the source files for skipped heading levels or multiple H1s, then re-bake.',
          });
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
