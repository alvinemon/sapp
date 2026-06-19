import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { canEditLibrary, libraryEditKey } from "./familyLibrary.js";
import { listPaymentMethods, type PaymentMethod } from "./payments.js";

export interface PremiumItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  url: string;
  price: string;
  currency: string;
  methodIds: string[];
  addedAt?: number;
}

export interface PremiumItemPublic extends Omit<PremiumItem, "url"> {
  locked: boolean;
  url?: string;
}

interface ContentFile {
  title: string;
  items: PremiumItem[];
}

interface UnlockRecord {
  contentId: string;
  code: string;
  methodId?: string;
  reference?: string;
  at: number;
}

interface PendingRequest {
  id: string;
  contentId: string;
  methodId: string;
  reference: string;
  at: number;
}

interface AccessFile {
  unlocks: UnlockRecord[];
  pending: PendingRequest[];
}

function contentPath(): string {
  const cwd = join(process.cwd(), "data", "premium-content.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "premium-content.json");
}

function accessPath(): string {
  const cwd = join(process.cwd(), "data", "premium-access.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "premium-access.json");
}

function readContent(): ContentFile {
  return JSON.parse(readFileSync(contentPath(), "utf8")) as ContentFile;
}

function writeContent(data: ContentFile) {
  writeFileSync(contentPath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function readAccess(): AccessFile {
  return JSON.parse(readFileSync(accessPath(), "utf8")) as AccessFile;
}

function writeAccess(data: AccessFile) {
  writeFileSync(accessPath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function genCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function isUnlocked(contentId: string, codes: string[]): boolean {
  const access = readAccess();
  return access.unlocks.some((u) => u.contentId === contentId && codes.includes(u.code));
}

export function listPremium(codes: string[] = []): {
  title: string;
  items: PremiumItemPublic[];
  requiresKey: boolean;
} {
  const { title, items } = readContent();
  const sorted = [...items].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  return {
    title,
    requiresKey: !!libraryEditKey(),
    items: sorted.map((item) => {
      const locked = !isUnlocked(item.id, codes);
      const pub: PremiumItemPublic = {
        id: item.id,
        title: item.title,
        description: item.description,
        thumbnail: item.thumbnail,
        price: item.price,
        currency: item.currency,
        methodIds: item.methodIds,
        addedAt: item.addedAt,
        locked,
      };
      if (!locked) pub.url = item.url;
      return pub;
    }),
  };
}

export function getPremiumPlayUrl(contentId: string, codes: string[]): string | null {
  if (!isUnlocked(contentId, codes)) return null;
  const item = readContent().items.find((i) => i.id === contentId);
  return item?.url ?? null;
}

export function addPremiumItem(input: Omit<PremiumItem, "id" | "addedAt">): PremiumItem {
  const file = readContent();
  const item: PremiumItem = {
    id: randomBytes(6).toString("hex"),
    title: input.title.trim(),
    description: input.description.trim(),
    thumbnail: input.thumbnail.trim(),
    url: input.url.trim(),
    price: input.price.trim(),
    currency: input.currency.trim() || "BDT",
    methodIds: input.methodIds,
    addedAt: Date.now(),
  };
  file.items.unshift(item);
  writeContent(file);
  return item;
}

export function removePremiumItem(id: string): boolean {
  const file = readContent();
  const before = file.items.length;
  file.items = file.items.filter((i) => i.id !== id);
  if (file.items.length === before) return false;
  writeContent(file);
  return true;
}

export function requestAccess(contentId: string, methodId: string, reference: string): PendingRequest {
  const access = readAccess();
  const req: PendingRequest = {
    id: randomBytes(6).toString("hex"),
    contentId,
    methodId,
    reference: reference.trim(),
    at: Date.now(),
  };
  access.pending.unshift(req);
  writeAccess(access);
  return req;
}

export function listPending(): PendingRequest[] {
  return readAccess().pending;
}

export function grantAccess(
  contentId: string,
  opts?: { methodId?: string; reference?: string },
): { code: string } {
  const access = readAccess();
  const code = genCode();
  access.unlocks.push({
    contentId,
    code,
    methodId: opts?.methodId,
    reference: opts?.reference,
    at: Date.now(),
  });
  access.pending = access.pending.filter((p) => p.contentId !== contentId);
  writeAccess(access);
  return { code };
}

export function approvePending(pendingId: string): { code: string; contentId: string } | null {
  const access = readAccess();
  const idx = access.pending.findIndex((p) => p.id === pendingId);
  if (idx < 0) return null;
  const pending = access.pending[idx];
  access.pending.splice(idx, 1);
  const code = genCode();
  access.unlocks.push({
    contentId: pending.contentId,
    code,
    methodId: pending.methodId,
    reference: pending.reference,
    at: Date.now(),
  });
  writeAccess(access);
  return { code, contentId: pending.contentId };
}

export function verifyCode(contentId: string, code: string): boolean {
  const access = readAccess();
  const ok = access.unlocks.some(
    (u) => u.contentId === contentId && u.code.toUpperCase() === code.trim().toUpperCase(),
  );
  return ok;
}

export function assertAdmin(editKey: string | undefined) {
  if (!canEditLibrary(editKey)) throw new Error("Invalid edit key");
}

export function methodsForItem(item: PremiumItem): PaymentMethod[] {
  const all = listPaymentMethods().methods;
  if (!item.methodIds.length) return all;
  return all.filter((m) => item.methodIds.includes(m.id));
}
