/** Catalog access checks — free, early access expiry, unlock codes, user library. */

import type { CatalogEpisode, CatalogItem } from "./catalog.js";
import { getCatalogItem } from "./catalog.js";
import { isUnlocked as premiumCodeUnlocked } from "./premium.js";
import { hasLibraryUnlock } from "./purchase.js";

export interface AccessDenied {
  status: 402;
  error: "payment_required";
  contentId: string;
  title: string;
  price?: number;
  currency?: string;
  earlyAccess: boolean;
  initiateUrl: string;
}

export function isEarlyAccessActive(item: CatalogItem): boolean {
  if (!item.earlyAccess) return false;
  if (!item.earlyAccessUntil) return true;
  const until = Date.parse(item.earlyAccessUntil);
  return !Number.isNaN(until) && until > Date.now();
}

export function isContentFree(item: CatalogItem): boolean {
  if (item.free && !isEarlyAccessActive(item)) return true;
  if (item.earlyAccess && item.earlyAccessUntil) {
    const until = Date.parse(item.earlyAccessUntil);
    if (!Number.isNaN(until) && until <= Date.now()) return true;
  }
  return item.free === true && !item.earlyAccess;
}

export function userCanAccessContent(
  item: CatalogItem,
  opts: { userId?: string; unlockCodes?: string[] },
): boolean {
  if (isContentFree(item)) return true;
  if (opts.userId && hasLibraryUnlock(opts.userId, item.id)) return true;
  if (premiumCodeUnlocked(item.id, opts.unlockCodes ?? [])) return true;
  if (opts.unlockCodes?.includes(`ea_${item.id}`)) return true;
  return false;
}

export function checkStreamAccess(
  catalogId: string,
  mediaPath: string,
  opts: { userId?: string; unlockCodes?: string[] },
): { allowed: true; item: CatalogItem; episode?: CatalogEpisode } | { allowed: false; denial: AccessDenied } {
  const item = getCatalogItem(catalogId);
  if (!item) {
    return {
      allowed: false,
      denial: {
        status: 402,
        error: "payment_required",
        contentId: catalogId,
        title: "Unknown",
        earlyAccess: false,
        initiateUrl: "/api/purchase/initiate",
      },
    };
  }

  let episode: CatalogEpisode | undefined;
  const parts = mediaPath.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0].startsWith("s") && parts[1].startsWith("e") && item.seasons) {
    const season = item.seasons.find((s) => s.id === parts[0]);
    episode = season?.episodes.find((e) => e.id === parts[1]);
  }

  const targetFree = episode ? episode.free && !isEarlyAccessActive(item) : isContentFree(item);
  if (targetFree) return { allowed: true, item, episode };

  if (userCanAccessContent(item, opts)) return { allowed: true, item, episode };

  return {
    allowed: false,
    denial: {
      status: 402,
      error: "payment_required",
      contentId: item.id,
      title: item.title,
      price: episode?.price ? Number(episode.price) : (item.price ? Number(item.price) : undefined),
      currency: item.currency ?? "BDT",
      earlyAccess: isEarlyAccessActive(item),
      initiateUrl: "/api/purchase/initiate",
    },
  };
}

export function parseAccessContext(req: { query: Record<string, unknown>; headers: Record<string, unknown> }): {
  userId?: string;
  unlockCodes: string[];
} {
  const userId =
    typeof req.query.userId === "string"
      ? req.query.userId
      : typeof req.headers["x-user-id"] === "string"
        ? req.headers["x-user-id"]
        : undefined;
  const codesRaw =
    typeof req.query.codes === "string"
      ? req.query.codes
      : typeof req.headers["x-unlock-codes"] === "string"
        ? req.headers["x-unlock-codes"]
        : "";
  const unlockCodes = codesRaw
    ? codesRaw.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
    : [];
  return { userId, unlockCodes };
}
