import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { assertAdmin } from "./authKeys.js";
import { listFamilyLibrary } from "./familyLibrary.js";
import { listFreeCatalog } from "./freeCatalog.js";
import { isUnlocked as premiumCodeUnlocked, listPremium } from "./premium.js";
import { hasLibraryUnlock } from "./purchase.js";

export type ContentType = "movie" | "series";

export interface CatalogEpisode {
  id: string;
  title: string;
  url?: string;
  duration?: number;
  free: boolean;
  price?: string;
  currency?: string;
  methodIds?: string[];
  telegramFileId?: string;
  telegramFileIds?: string[];
  subtitleFileId?: string;
}

export interface CatalogSeason {
  id: string;
  name: string;
  episodes: CatalogEpisode[];
}

export interface CatalogItem {
  id: string;
  type: ContentType;
  title: string;
  description: string;
  thumb: string;
  free: boolean;
  url?: string;
  price?: string;
  currency?: string;
  methodIds?: string[];
  category?: string;
  year?: number;
  seasons?: CatalogSeason[];
  addedAt?: number;
  /** Telegram CDN — streamed via relay proxy in app */
  telegramFileId?: string;
  telegramFileIds?: string[];
  thumbTelegramFileId?: string;
  subtitleFileId?: string;
  /** Early access — paid unlock via dynamic pricing */
  earlyAccess?: boolean;
  earlyAccessUntil?: string;
  source?: "telegram" | "url" | string;
}

interface CatalogFile {
  title: string;
  items: CatalogItem[];
}

function catalogPath(): string {
  const cwd = join(process.cwd(), "data", "catalog.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "catalog.json");
}

function readCatalog(): CatalogFile {
  if (!existsSync(catalogPath())) {
    const migrated = migrateLegacyCatalog();
    writeCatalog(migrated);
    return migrated;
  }
  return JSON.parse(readFileSync(catalogPath(), "utf8")) as CatalogFile;
}

function writeCatalog(data: CatalogFile) {
  writeFileSync(catalogPath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function migrateLegacyCatalog(): CatalogFile {
  const items: CatalogItem[] = [];
  try {
    const free = listFreeCatalog();
    for (const f of free.items) {
      items.push({
        id: `free_${f.id}`,
        type: f.kind === "tv" ? "series" : "movie",
        title: f.title,
        description: f.category,
        thumb: f.thumb,
        free: true,
        url: f.streamUrl,
        category: f.category,
        year: f.year,
        addedAt: Date.now(),
      });
    }
  } catch { /* ignore */ }
  try {
    const fam = listFamilyLibrary();
    for (const f of fam.items) {
      items.push({
        id: `fam_${f.id}`,
        type: "movie",
        title: f.title,
        description: f.description,
        thumb: f.thumbnail,
        free: true,
        url: f.url,
        addedAt: f.addedAt ?? Date.now(),
      });
    }
  } catch { /* ignore */ }
  try {
    const prem = listPremium();
    for (const p of prem.items) {
      items.push({
        id: p.id,
        type: "movie",
        title: p.title,
        description: p.description,
        thumb: p.thumbnail,
        free: false,
        url: p.url,
        price: p.price,
        currency: p.currency,
        methodIds: p.methodIds,
        addedAt: p.addedAt ?? Date.now(),
      });
    }
  } catch { /* ignore */ }
  return { title: "2hotatl", items };
}

export type CatalogItemPublic = Omit<CatalogItem, "url"> & {
  url?: string;
  locked?: boolean;
  earlyAccessActive?: boolean;
};

export function listCatalogPublic(unlockCodes: string[] = [], userId?: string): {
  title: string;
  items: CatalogItemPublic[];
} {
  const { title, items } = readCatalog();
  const sorted = [...items].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  return {
    title,
    items: sorted.map((item) => toPublic(item, unlockCodes, userId)),
  };
}

function isUnlocked(item: CatalogItem, codes: string[], userId?: string): boolean {
  if (item.free && !isEarlyAccessActive(item)) return true;
  if (userId && hasLibraryUnlock(userId, item.id)) return true;
  if (item.free) return true;
  return premiumCodeUnlocked(item.id, codes);
}

function isEarlyAccessActive(item: CatalogItem): boolean {
  if (!item.earlyAccess) return false;
  if (!item.earlyAccessUntil) return true;
  const until = Date.parse(item.earlyAccessUntil);
  return !Number.isNaN(until) && until > Date.now();
}

function toPublic(item: CatalogItem, codes: string[], userId?: string): CatalogItemPublic {
  const earlyActive = isEarlyAccessActive(item);
  const unlocked = isUnlocked(item, codes, userId) || (earlyActive && codes.includes(`ea_${item.id}`));
  const needsLock = (!item.free && !unlocked) || (earlyActive && !unlocked);
  const pub: CatalogItemPublic = {
    ...item,
    locked: needsLock,
    earlyAccessActive: earlyActive,
  };
  if (needsLock) {
    delete pub.url;
    if (pub.seasons) {
      pub.seasons = pub.seasons.map((s) => ({
        ...s,
        episodes: s.episodes.map((e) => ({
          ...e,
          url: e.free && !earlyActive ? e.url : undefined,
        })),
      }));
    }
  }
  return pub;
}

export function listCatalogAdmin(editKey?: string) {
  assertAdmin(editKey);
  return readCatalog();
}

export function addCatalogItem(
  input: Omit<CatalogItem, "id" | "addedAt">,
  editKey?: string,
): CatalogItem {
  assertAdmin(editKey);
  const file = readCatalog();
  const item: CatalogItem = {
    ...input,
    id: randomBytes(6).toString("hex"),
    addedAt: Date.now(),
  };
  file.items.unshift(item);
  writeCatalog(file);
  return item;
}

export function updateCatalogItem(
  id: string,
  patch: Partial<CatalogItem>,
  editKey?: string,
): CatalogItem | null {
  assertAdmin(editKey);
  const file = readCatalog();
  const idx = file.items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  file.items[idx] = { ...file.items[idx], ...patch, id };
  writeCatalog(file);
  return file.items[idx];
}

export function removeCatalogItem(id: string, editKey?: string): boolean {
  assertAdmin(editKey);
  const file = readCatalog();
  const before = file.items.length;
  file.items = file.items.filter((i) => i.id !== id);
  if (file.items.length === before) return false;
  writeCatalog(file);
  return true;
}

export function getCatalogItem(id: string): CatalogItem | null {
  return readCatalog().items.find((i) => i.id === id) ?? null;
}

export function findCatalogItemByMediaPath(catalogId: string, mediaPath: string): {
  item: CatalogItem;
  episode?: CatalogEpisode;
} | null {
  const item = getCatalogItem(catalogId);
  if (!item) return null;
  const parts = mediaPath.split("/").filter(Boolean);
  if (!parts.length) return { item };
  if (parts.length >= 2 && parts[0].startsWith("s") && parts[1].startsWith("e") && item.seasons) {
    const season = item.seasons.find((s) => s.id === parts[0]);
    const episode = season?.episodes.find((e) => e.id === parts[1]);
    if (season && episode) return { item, episode };
  }
  return { item };
}

export function getCatalogPlayUrl(id: string, codes: string[]): string | null {
  const item = getCatalogItem(id);
  if (!item) return null;
  if (item.free || isUnlocked(item, codes)) return item.url ?? null;
  return null;
}
