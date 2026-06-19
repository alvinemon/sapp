import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export interface FamilyLibraryItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  url: string;
  addedAt?: number;
}

interface LibraryFile {
  title: string;
  items: FamilyLibraryItem[];
}

function libraryPath(): string {
  const cwd = join(process.cwd(), "data", "family-library.json");
  if (existsSync(cwd)) return cwd;
  const serverDir = dirname(fileURLToPath(import.meta.url));
  return join(serverDir, "..", "data", "family-library.json");
}

function readFile(): LibraryFile {
  const raw = readFileSync(libraryPath(), "utf8");
  return JSON.parse(raw) as LibraryFile;
}

function writeFile(data: LibraryFile) {
  writeFileSync(libraryPath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function listFamilyLibrary() {
  const file = readFile();
  const items = [...file.items].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  return { title: file.title, items };
}

export function libraryEditKey(): string | null {
  return process.env.LIBRARY_EDIT_KEY?.trim() || null;
}

export function canEditLibrary(key: string | undefined): boolean {
  const expected = libraryEditKey();
  if (!expected) return true;
  return key === expected;
}

export function addFamilyItem(input: {
  title: string;
  description: string;
  thumbnail: string;
  url: string;
}): FamilyLibraryItem {
  const file = readFile();
  const item: FamilyLibraryItem = {
    id: randomBytes(6).toString("hex"),
    title: input.title.trim(),
    description: input.description.trim(),
    thumbnail: input.thumbnail.trim(),
    url: input.url.trim(),
    addedAt: Date.now(),
  };
  file.items.unshift(item);
  writeFile(file);
  return item;
}

export function removeFamilyItem(id: string): boolean {
  const file = readFile();
  const before = file.items.length;
  file.items = file.items.filter((i) => i.id !== id);
  if (file.items.length === before) return false;
  writeFile(file);
  return true;
}
