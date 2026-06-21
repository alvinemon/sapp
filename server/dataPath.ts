import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Persistent disk on Render mounts at /data; override with RENDER_DISK_PATH. */
export function dataRoot(): string {
  const disk = process.env.RENDER_DISK_PATH?.trim();
  if (disk) return disk;
  return join(process.cwd(), "data");
}

export function dataPath(...parts: string[]): string {
  const root = dataRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return join(root, ...parts);
}

/** Alias for dataPath */
export const dataFile = dataPath;
