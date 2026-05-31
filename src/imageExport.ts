import { App, TFile, Vault } from 'obsidian';

const FILE_URI_RE = /!\[([^\]]*)\]\(file:\/\/\/?([^)]+)\)/g;

function decodeFilePath(uriPath: string): string {
  // On Windows the URI is file:///C:/... so uriPath starts with C:/
  return decodeURIComponent(uriPath.replace(/\//g, '/'));
}

export async function exportImages(
  app: App,
  bakedText: string,
  outputFolderPath: string,
  outputBaseName: string
): Promise<string> {
  const assetsFolderName = `${outputBaseName}_assets`;
  const assetsFolderPath = outputFolderPath
    ? `${outputFolderPath}/${assetsFolderName}`
    : assetsFolderName;

  const { vault } = app;
  const matches = [...bakedText.matchAll(FILE_URI_RE)];
  if (matches.length === 0) return bakedText;

  // Ensure assets folder exists
  if (!vault.getAbstractFileByPath(assetsFolderPath)) {
    await vault.createFolder(assetsFolderPath);
  }

  let result = bakedText;

  for (const match of matches) {
    const [fullMatch, altText, rawPath] = match;
    const absolutePath = decodeFilePath(rawPath);

    // Find the corresponding TFile in the vault by matching vault-relative path
    const vaultFiles = vault.getFiles();
    const sourceFile = vaultFiles.find(
      (f) => absolutePath.endsWith(f.path) || absolutePath.endsWith('/' + f.name)
    );

    if (!sourceFile) continue;

    const destPath = `${assetsFolderPath}/${sourceFile.name}`;
    const destRelative = `./${assetsFolderName}/${sourceFile.name}`;

    // Copy if not already there
    if (!vault.getAbstractFileByPath(destPath)) {
      const data = await vault.readBinary(sourceFile);
      await vault.createBinary(destPath, data);
    }

    result = result.replace(fullMatch, `![${altText}](${destRelative})`);
  }

  return result;
}
