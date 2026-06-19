import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface FreeCatalogItem {
  id: string;
  title: string;
  year: number;
  category: string;
  kind: "movie" | "tv";
  streamUrl: string;
  thumb: string;
}

interface CatalogFile {
  source: string;
  items: FreeCatalogItem[];
}

function catalogPath(): string {
  const cwd = join(process.cwd(), "data", "free-catalog.json");
  if (existsSync(cwd)) return cwd;
  const serverDir = dirname(fileURLToPath(import.meta.url));
  return join(serverDir, "..", "data", "free-catalog.json");
}

let cached: CatalogFile | null = null;

export function loadFreeCatalog(): CatalogFile {
  if (cached) return cached;
  const raw = readFileSync(catalogPath(), "utf8");
  cached = JSON.parse(raw) as CatalogFile;
  return cached;
}

export function listFreeCatalog(kind?: string, category?: string) {
  const { source, items } = loadFreeCatalog();
  let out = items;
  if (kind) out = out.filter((i) => i.kind === kind);
  if (category) out = out.filter((i) => i.category === category);
  return { source, items: out, categories: [...new Set(items.map((i) => i.category))].sort() };
}

export function findFreeItem(id: string): FreeCatalogItem | undefined {
  return loadFreeCatalog().items.find((i) => i.id === id);
}

/** Pick best MP4 from Internet Archive metadata when stream URL needs refresh. */
export async function resolveArchiveStream(archiveId: string): Promise<string | null> {
  const known = findFreeItem(archiveId);
  if (known?.streamUrl) return known.streamUrl;

  try {
    const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(archiveId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      files?: { name: string; format?: string; size?: string }[];
    };
    const mp4s = (data.files ?? []).filter(
      (f) => f.name.toLowerCase().endsWith(".mp4") && !f.name.toLowerCase().includes("thumb"),
    );
    if (mp4s.length === 0) return null;
    mp4s.sort((a, b) => Number(a.size ?? 0) - Number(b.size ?? 0));
    const pick = mp4s[Math.min(1, mp4s.length - 1)];
    return `https://archive.org/download/${archiveId}/${encodeURIComponent(pick.name)}`;
  } catch {
    return null;
  }
}
