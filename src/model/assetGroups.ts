/**
 * Asset groups: a flat, ordered list of named groups used to organise the Assets tab
 * (each group is a collapsible section). Files stay in assets/; only the grouping is stored:
 *   "assetGroups": { "groups": ["Storyboard", "Lighting"], "files": { "assets/a.png": "Storyboard" } }
 * Assets not listed are "Ungrouped".
 */
import type { Project } from "./schema";

export const UNGROUPED = "";

/** Group of an asset ("" when ungrouped or its group no longer exists). */
export function groupOf(p: Project, rel: string): string {
  const g = p.assetGroups.files[rel];
  return g && p.assetGroups.groups.includes(g) ? g : UNGROUPED;
}

/** Assets of a group ("" = ungrouped), in the order of `assets`. */
export function filesInGroup(p: Project, group: string, assets: string[]): string[] {
  return assets.filter((rel) => groupOf(p, rel) === group);
}

const cleanName = (name: string) => name.trim();

function uniqueName(p: Project, name: string, except?: string): string {
  const base = cleanName(name) || "New group";
  const taken = new Set(p.assetGroups.groups.filter((g) => g !== except));
  let out = base;
  for (let n = 2; taken.has(out); n++) out = `${base} ${n}`;
  return out;
}

/** Adds a group at the end; returns its (unique) name. */
export function addGroup(p: Project, name = "New group"): string {
  const g = uniqueName(p, name);
  p.assetGroups.groups.push(g);
  return g;
}

/** Renames a group (its files follow); returns the new name. */
export function renameGroup(p: Project, group: string, name: string): string {
  if (!cleanName(name)) return group;
  const to = uniqueName(p, name, group);
  if (to === group) return group;
  p.assetGroups.groups = p.assetGroups.groups.map((g) => (g === group ? to : g));
  for (const [rel, g] of Object.entries(p.assetGroups.files)) if (g === group) p.assetGroups.files[rel] = to;
  return to;
}

/** Removes a group; its files become ungrouped. */
export function deleteGroup(p: Project, group: string) {
  p.assetGroups.groups = p.assetGroups.groups.filter((g) => g !== group);
  for (const [rel, g] of Object.entries(p.assetGroups.files)) if (g === group) delete p.assetGroups.files[rel];
}

/** Moves a group up (-1) or down (+1) in the list. */
export function moveGroup(p: Project, group: string, delta: number) {
  const i = p.assetGroups.groups.indexOf(group);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= p.assetGroups.groups.length) return;
  const [g] = p.assetGroups.groups.splice(i, 1);
  p.assetGroups.groups.splice(j, 0, g);
}

/** Puts assets into `group` ("" = ungrouped). */
export function assignAssets(p: Project, rels: string[], group: string) {
  for (const rel of rels) {
    if (group && p.assetGroups.groups.includes(group)) p.assetGroups.files[rel] = group;
    else delete p.assetGroups.files[rel];
  }
}

/** Keeps the group of an asset whose file was renamed. */
export function renameAssetInGroups(p: Project, from: string, to: string) {
  const g = p.assetGroups.files[from];
  if (g === undefined) return;
  delete p.assetGroups.files[from];
  p.assetGroups.files[to] = g;
}

/** Repairs hand-edited data: unique non-empty group names, no entries pointing to unknown groups. */
export function syncAssetGroups(p: Project) {
  p.assetGroups.groups = [...new Set(p.assetGroups.groups.map(cleanName).filter(Boolean))];
  const known = new Set(p.assetGroups.groups);
  for (const [rel, g] of Object.entries(p.assetGroups.files)) if (!known.has(g)) delete p.assetGroups.files[rel];
}
