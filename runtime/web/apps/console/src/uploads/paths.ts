import { projectPath } from "../projects/queries";

export function joinPath(...parts: string[]): string {
  return parts.flatMap((part) => part.split("/")).filter(Boolean).join("/");
}

export function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function folderNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Give the folder a name.";
  if (/[/\\]/.test(trimmed)) return "A folder name can't have / or \\ in it.";
  if (trimmed === "." || trimmed === "..") return "Pick a different name.";
  return null;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function listingUrl(projectId: string, dir: string): string {
  return `${projectPath(projectId)}/files?dir=${encodeURIComponent(dir)}`;
}

export function fileUrl(projectId: string, path: string): string {
  return `${projectPath(projectId)}/files/${encodePath(path)}`;
}

export function filesRoute(projectId: string, dir: string): string {
  const base = `/p/${encodeURIComponent(projectId)}/files`;
  return dir === "" ? base : `${base}/${encodePath(dir)}`;
}
