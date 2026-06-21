import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { CatalogEpisode, CatalogItem, CatalogSeason } from "./catalog.js";

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");

export function getTelegramBotToken(): string | null {
  const env = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (env) return env;
  for (const name of ["config.yaml", "config.example.yaml"]) {
    const path = join(PIPELINE_DIR, name);
    if (!existsSync(path)) continue;
    try {
      const raw = parseYaml(readFileSync(path, "utf8")) as Record<string, unknown>;
      const token = String((raw.telegram as Record<string, unknown> | undefined)?.bot_token ?? "").trim();
      if (token && !token.startsWith("YOUR_")) return token;
    } catch { /* ignore */ }
  }
  return null;
}

export async function resolveTelegramFileUrl(fileId: string): Promise<string | null> {
  const token = getTelegramBotToken();
  if (!token || !fileId) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = (await res.json()) as { ok?: boolean; result?: { file_path?: string } };
  if (!data.ok || !data.result?.file_path) return null;
  return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}

export interface ResolvedMedia {
  item: CatalogItem;
  episode?: CatalogEpisode;
  fileIds: string[];
  thumbFileId?: string;
  externalThumb?: string;
}

/** Parse tg_abc/s1/e3 style paths into catalog item + optional episode. */
export function resolveCatalogMedia(item: CatalogItem, mediaPath: string): ResolvedMedia | null {
  const parts = mediaPath.split("/").filter(Boolean);
  if (!parts.length) return null;

  if (parts.length === 1) {
    const fileIds = item.telegramFileIds?.length
      ? item.telegramFileIds
      : item.telegramFileId
        ? [item.telegramFileId]
        : [];
    return {
      item,
      fileIds,
      thumbFileId: item.thumbTelegramFileId,
      externalThumb: item.thumb?.startsWith("http") && !item.thumb.includes("/api/catalog/thumb/")
        ? item.thumb
        : undefined,
    };
  }

  if (parts[0]?.startsWith("s") && parts[1]?.startsWith("e") && item.seasons?.length) {
    const sn = parts[0].slice(1);
    const en = parts[1].slice(1);
    const season = item.seasons.find((s) => s.id === `s${sn}` || s.id === parts[0]);
    const episode = season?.episodes.find((e) => e.id === `e${en}` || e.id === parts[1]);
    if (!episode) return null;
    const fileIds = episode.telegramFileIds?.length
      ? episode.telegramFileIds
      : episode.telegramFileId
        ? [episode.telegramFileId]
        : item.telegramFileIds ?? (item.telegramFileId ? [item.telegramFileId] : []);
    return { item, episode, fileIds, thumbFileId: item.thumbTelegramFileId };
  }

  return null;
}

export function buildHlsPlaylist(baseUrl: string, partCount: number): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:36000", "#EXT-X-MEDIA-SEQUENCE:0"];
  for (let i = 0; i < partCount; i += 1) {
    lines.push("#EXTINF:36000.0,");
    lines.push(`${baseUrl}/part/${i}`);
  }
  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

export function categoriesFromCatalog(items: CatalogItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.category) set.add(item.category);
  }
  return [...set].sort();
}
