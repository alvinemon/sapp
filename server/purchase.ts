/** Purchase orders + user library entitlements (SQLite). */

import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dataPath } from "./dataPath.js";
import { fetchPricingQuote, postPricingAttempt } from "./pricingProxy.js";
import { listPaymentMethods } from "./payments.js";
import { getCatalogItem } from "./catalog.js";
import { getMethodById, verifyAutoPayment } from "./paymentProviders.js";

function dbPath(): string {
  const dir = dataPath("pipeline");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dataPath("pipeline", "purchase.db");
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        order_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content_id TEXT NOT NULL,
        price REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'BDT',
        status TEXT NOT NULL DEFAULT 'pending',
        method_id TEXT,
        reference TEXT,
        payment_token TEXT,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS user_library (
        user_id TEXT NOT NULL,
        content_id TEXT NOT NULL,
        order_id TEXT,
        price_paid REAL,
        purchased_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, content_id)
      );
      CREATE INDEX IF NOT EXISTS idx_orders_user ON purchase_orders(user_id);
    `);
  }
  return db;
}

export interface PurchaseOrder {
  orderId: string;
  userId: string;
  contentId: string;
  price: number;
  currency: string;
  status: "pending" | "confirmed" | "failed";
  methodId?: string;
  reference?: string;
  createdAt: number;
}

function rowToOrder(row: Record<string, unknown>): PurchaseOrder {
  return {
    orderId: String(row.order_id),
    userId: String(row.user_id),
    contentId: String(row.content_id),
    price: Number(row.price),
    currency: String(row.currency ?? "BDT"),
    status: String(row.status) as PurchaseOrder["status"],
    methodId: row.method_id ? String(row.method_id) : undefined,
    reference: row.reference ? String(row.reference) : undefined,
    createdAt: Number(row.created_at),
  };
}

export function hasLibraryUnlock(userId: string, contentId: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM user_library WHERE user_id = ? AND content_id = ?")
    .get(userId, contentId);
  return !!row;
}

export function listUserLibrary(userId: string): Array<{ contentId: string; purchasedAt: number; pricePaid: number | null }> {
  const rows = getDb()
    .prepare("SELECT content_id, purchased_at, price_paid FROM user_library WHERE user_id = ? ORDER BY purchased_at DESC")
    .all(userId) as Array<{ content_id: string; purchased_at: number; price_paid: number | null }>;
  return rows.map((r) => ({
    contentId: r.content_id,
    purchasedAt: r.purchased_at,
    pricePaid: r.price_paid,
  }));
}

export async function initiatePurchase(
  userId: string,
  contentId: string,
  methodId?: string,
): Promise<Record<string, unknown>> {
  const item = getCatalogItem(contentId);
  if (!item) throw new Error("content not found");

  const quote = await fetchPricingQuote(userId, contentId);
  const price = Number(quote.price ?? quote.recommended_price ?? 100);
  const currency = String(quote.currency ?? item.currency ?? "BDT");

  const orderId = randomBytes(8).toString("hex");
  getDb()
    .prepare(
      `INSERT INTO purchase_orders (order_id, user_id, content_id, price, currency, status, method_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(orderId, userId, contentId, price, currency, methodId ?? null, Date.now());

  await postPricingAttempt({
    user_id: userId,
    content_id: contentId,
    price_shown: price,
    purchased: 0,
  }).catch(() => {});

  const methods = listPaymentMethods().methods.filter(
    (m) => !item.methodIds?.length || item.methodIds.includes(m.id),
  );

  return {
    ok: true,
    orderId,
    userId,
    contentId,
    title: item.title,
    price,
    currency,
    paymentMethods: methods,
    initiateUrl: `/api/purchase/confirm`,
  };
}

export async function confirmPurchase(
  orderId: string,
  paymentToken?: string,
  reference?: string,
): Promise<{ ok: boolean; contentId: string; userId: string }> {
  const row = getDb()
    .prepare("SELECT * FROM purchase_orders WHERE order_id = ?")
    .get(orderId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("order not found");
  if (String(row.status) === "confirmed") {
    return { ok: true, contentId: String(row.content_id), userId: String(row.user_id) };
  }

  const methodId = String(row.method_id ?? "bkash");
  const ref = (reference ?? paymentToken ?? String(row.reference ?? "")).trim();
  const method = getMethodById(methodId);
  let verified = false;

  if (method && ref.length >= 6) {
    const result = await verifyAutoPayment(method, {
      provider: (method.provider ?? "bkash") as "bkash" | "surjo" | "nagad" | "custom",
      reference: ref,
      amount: String(row.price),
      contentId: String(row.content_id),
      methodId,
    });
    verified = result.ok;
  } else if (ref.length >= 6) {
    verified = true;
  }

  if (!verified) throw new Error("payment verification failed");

  const now = Date.now();
  getDb()
    .prepare("UPDATE purchase_orders SET status = 'confirmed', confirmed_at = ?, payment_token = ?, reference = ? WHERE order_id = ?")
    .run(now, paymentToken ?? null, ref || null, orderId);

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO user_library (user_id, content_id, order_id, price_paid, purchased_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(String(row.user_id), String(row.content_id), orderId, Number(row.price), now);

  await postPricingAttempt({
    user_id: String(row.user_id),
    content_id: String(row.content_id),
    price_shown: Number(row.price),
    purchased: 1,
  }).catch(() => {});

  return { ok: true, contentId: String(row.content_id), userId: String(row.user_id) };
}

export function getOrder(orderId: string): PurchaseOrder | null {
  const row = getDb().prepare("SELECT * FROM purchase_orders WHERE order_id = ?").get(orderId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToOrder(row) : null;
}
