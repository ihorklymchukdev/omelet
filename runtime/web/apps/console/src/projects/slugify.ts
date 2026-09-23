// Must match the API's _slug: runs of anything outside [a-z0-9-] become one
// dash, but existing dashes are kept as they are.
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}
