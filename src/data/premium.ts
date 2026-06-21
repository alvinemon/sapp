export interface PaymentMethod {
  id: string;
  name: string;
  account: string;
  instructions: string;
  enabled: boolean;
  mode?: "manual" | "auto";
  provider?: string;
}

export interface PremiumItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  price: string;
  currency: string;
  methodIds: string[];
  locked: boolean;
  url?: string;
  addedAt?: number;
}

export interface PendingPayment {
  id: string;
  contentId: string;
  methodId: string;
  reference: string;
  at: number;
}

const CODES_KEY = "premium_unlock_codes";

export function getStoredCodes(): string[] {
  try {
    const raw = localStorage.getItem(CODES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.map((c) => c.toUpperCase()) : [];
  } catch {
    return [];
  }
}

export function storeCode(code: string) {
  const codes = getStoredCodes();
  const up = code.trim().toUpperCase();
  if (!codes.includes(up)) {
    codes.push(up);
    localStorage.setItem(CODES_KEY, JSON.stringify(codes));
  }
}

function codesQuery(): string {
  const codes = getStoredCodes();
  return codes.length ? `?codes=${encodeURIComponent(codes.join(","))}` : "";
}

export async function fetchPremium(): Promise<{
  title: string;
  items: PremiumItem[];
  requiresKey: boolean;
}> {
  const res = await fetch(`/api/premium${codesQuery()}`);
  if (!res.ok) throw new Error("Could not load premium catalog");
  return res.json() as Promise<{ title: string; items: PremiumItem[]; requiresKey: boolean }>;
}

export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const res = await fetch("/api/payment-methods");
  if (!res.ok) throw new Error("Could not load payment methods");
  const data = (await res.json()) as { methods: PaymentMethod[] };
  return data.methods;
}

export async function fetchPaymentMethodsAdmin(editKey: string): Promise<PaymentMethod[]> {
  const res = await fetch(`/api/payment-methods?all=1&editKey=${encodeURIComponent(editKey)}`);
  if (!res.ok) throw new Error("Could not load methods");
  const data = (await res.json()) as { methods: PaymentMethod[] };
  return data.methods;
}

export async function addPaymentMethod(
  input: { name: string; account: string; instructions: string },
  editKey?: string,
): Promise<PaymentMethod> {
  const res = await fetch("/api/payment-methods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, editKey }),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed");
  return res.json() as Promise<PaymentMethod>;
}

export async function removePaymentMethod(id: string, editKey?: string): Promise<void> {
  const res = await fetch(`/api/payment-methods/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey }),
  });
  if (!res.ok) throw new Error("Failed to remove method");
}

export async function addPremiumItem(
  input: {
    title: string;
    description: string;
    thumbnail: string;
    url: string;
    price: string;
    currency: string;
    methodIds: string[];
  },
  editKey?: string,
): Promise<PremiumItem> {
  const res = await fetch("/api/premium", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, editKey }),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed");
  return res.json() as Promise<PremiumItem>;
}

export async function removePremiumItem(id: string, editKey?: string): Promise<void> {
  const res = await fetch(`/api/premium/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey }),
  });
  if (!res.ok) throw new Error("Failed to remove");
}

export async function requestPremiumAccess(
  contentId: string,
  methodId: string,
  reference: string,
): Promise<{ message: string }> {
  const res = await fetch("/api/premium/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentId, methodId, reference }),
  });
  if (!res.ok) throw new Error("Request failed");
  return res.json() as Promise<{ message: string }>;
}

export async function verifyPremiumCode(
  contentId: string,
  code: string,
  attribution?: { offerId?: string; campaignId?: string; deviceId?: string },
): Promise<{ ok: boolean; url?: string }> {
  const res = await fetch("/api/premium/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentId, code, ...attribution }),
  });
  const data = (await res.json()) as { ok: boolean; url?: string };
  if (data.ok) storeCode(code);
  return data;
}

export async function fetchPendingPayments(editKey: string): Promise<PendingPayment[]> {
  const res = await fetch(`/api/premium/pending?editKey=${encodeURIComponent(editKey)}`);
  if (!res.ok) throw new Error("Failed");
  const data = (await res.json()) as { pending: PendingPayment[] };
  return data.pending;
}

export async function approvePending(pendingId: string, editKey: string): Promise<{ code: string }> {
  const res = await fetch(`/api/premium/pending/${encodeURIComponent(pendingId)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey }),
  });
  if (!res.ok) throw new Error("Approve failed");
  return res.json() as Promise<{ code: string }>;
}

export async function grantPremium(contentId: string, editKey: string): Promise<{ code: string }> {
  const res = await fetch("/api/premium/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentId, editKey }),
  });
  if (!res.ok) throw new Error("Grant failed");
  return res.json() as Promise<{ code: string }>;
}
