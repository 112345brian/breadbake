/**
 * Optional integration with the Breadcrumbs plugin (michaelpporter/breadcrumbs v4).
 *
 * All functions gracefully return empty/null when BC is not installed.
 * The graph is accessed via `app.plugins.plugins.breadcrumbs` — no hard
 * dependency on the BC package.
 */

import { App, TFile } from 'obsidian';

function getBC(app: App): any | null {
  return (app as any).plugins?.plugins?.breadcrumbs ?? null;
}

/** True if the Breadcrumbs plugin is loaded and its graph is ready. */
export function isBCAvailable(app: App): boolean {
  const bc = getBC(app);
  return !!(bc?.graph && bc?.api);
}

/**
 * Returns the user's configured edge field labels (e.g. ["up","down","next","prev","people"]).
 * Falls back to the bripey-bake defaults if BC is not available.
 */
export function getBCEdgeFields(app: App): string[] {
  const bc = getBC(app);
  if (!bc) return ['up', 'down', 'same', 'next', 'prev'];
  return (bc.settings?.edge_fields ?? []).map((f: any) =>
    typeof f === 'string' ? f : (f.label ?? String(f))
  );
}

/**
 * Returns all outgoing edges from `file` with the given field name,
 * using the BC WASM graph. Respects ALL BC edge sources — typed_link,
 * folder_note, tag_note, dataview_note, dendron_note, etc.
 *
 * Falls back to an empty array if BC is unavailable or the query fails.
 */
export function getOutgoingBCEdges(app: App, file: TFile, fieldName: string): TFile[] {
  const bc = getBC(app);
  if (!bc?.graph) return [];

  try {
    if (!bc.graph.has_node(file.path)) return [];

    const edgeList = bc.graph.get_outgoing_edges(file.path);
    const edges: any[] = edgeList.to_array();

    return edges
      .filter((e: any) => e.edge_type === fieldName)
      .map((e: any) => {
        const targetPath: string = e.target_path(bc.graph);
        return app.vault.getAbstractFileByPath(targetPath);
      })
      .filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
  } catch (err) {
    console.warn('[bripey-bake] BC graph query failed, falling back to frontmatter:', err);
    return [];
  }
}

/**
 * Subscribes to BC's "graph-update" event.
 * Returns an unsubscribe function, or null if BC is not available.
 */
export function onBCGraphUpdate(app: App, callback: () => void): (() => void) | null {
  const bc = getBC(app);
  if (!bc?.events) return null;

  try {
    const eventRef = bc.events.on('graph-update', callback);
    return () => bc.events.offref(eventRef);
  } catch {
    return null;
  }
}
