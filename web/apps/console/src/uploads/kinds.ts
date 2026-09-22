export type Kind = "dump" | "archive";

const DUMP = [".sql", ".sql.gz", ".dump", ".bak", ".backup"];
const ARCHIVE = [".zip", ".tar", ".tar.gz", ".tgz"];

export function kindOf(name: string): Kind | null {
  const lower = name.toLowerCase();
  // Dumps first: ".sql.gz" must not fall through to an archive check.
  if (DUMP.some((ext) => lower.endsWith(ext))) return "dump";
  if (ARCHIVE.some((ext) => lower.endsWith(ext))) return "archive";
  return null;
}

export function promptFor(kind: Kind, path: string): string {
  if (kind === "dump") {
    return `I uploaded a database dump to ${path} in this project. Please import it into the project's database using the credentials already configured, then tell me which tables landed and roughly how many rows each one has.`;
  }
  return `I uploaded ${path} to this project. Please unpack it where it belongs in the project, tell me what was inside, and delete the archive once everything is in place.`;
}
