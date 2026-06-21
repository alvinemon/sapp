import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { assertAdmin } from "./authKeys.js";
import { resolveAccess } from "./marketingAuth.js";
import { resolveDeepSeekApiKey } from "./agent.js";
import { listCatalogPublic } from "./catalog.js";

export interface OfferTemplate {
  id: string;
  name: string;
  title: string;
  reason: string;
  body: string;
  contentId?: string;
  discount?: string;
  createdAt: number;
}

function templatesPath(): string {
  const cwd = join(process.cwd(), "data", "offer-templates.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "offer-templates.json");
}

function readTemplates(): OfferTemplate[] {
  const path = templatesPath();
  if (!existsSync(path)) return defaultTemplates();
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { templates?: OfferTemplate[] };
    return data.templates?.length ? data.templates : defaultTemplates();
  } catch {
    return defaultTemplates();
  }
}

function defaultTemplates(): OfferTemplate[] {
  const now = Date.now();
  return [
    {
      id: "bn_weekend",
      name: "সাপ্তাহিক ডিল",
      title: "এই সপ্তাহের বিশেষ অফার",
      reason: "আপনার জন্য বাছাই করা প্রিমিয়াম কনটেন্ট",
      body: "সীমিত সময়ের জন্য বিশেষ মূল্যে আনলক করুন।",
      discount: "২০% ছাড়",
      createdAt: now,
    },
    {
      id: "bn_new_user",
      name: "নতুন ব্যবহারকারী",
      title: "স্বাগতম! আপনার জন্য একটি উপহার",
      reason: "২hotatl-এ যোগ দেওয়ার জন্য ধন্যবাদ",
      body: "প্রথম প্রিমিয়াম শো বিনামূল্যে দেখুন — আজই চেষ্টা করুন।",
      createdAt: now,
    },
    {
      id: "bn_shopping",
      name: "শপিং সিগন্যাল",
      title: "আপনার কেনাকাটার জন্য একটি পিক",
      reason: "আপনার সাম্প্রতিক অ্যাক্টিভিটি দেখে বাছাই করা",
      body: "প্রিমিয়াম কনটেন্ট আনলক করুন — বিশেষ দামে।",
      createdAt: now,
    },
  ];
}

function writeTemplates(templates: OfferTemplate[]) {
  const path = templatesPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ templates }, null, 2) + "\n", "utf8");
}

export function listOfferTemplates(editKey?: string): OfferTemplate[] {
  assertAdmin(editKey);
  return readTemplates();
}

export function saveOfferTemplate(
  input: Omit<OfferTemplate, "id" | "createdAt">,
  editKey?: string,
): OfferTemplate {
  assertAdmin(editKey);
  const t: OfferTemplate = {
    id: randomBytes(4).toString("hex"),
    ...input,
    createdAt: Date.now(),
  };
  const all = readTemplates();
  all.unshift(t);
  writeTemplates(all.slice(0, 100));
  return t;
}

export function deleteOfferTemplate(id: string, editKey?: string): boolean {
  assertAdmin(editKey);
  const all = readTemplates();
  const next = all.filter((t) => t.id !== id);
  if (next.length === all.length) return false;
  writeTemplates(next);
  return true;
}

export async function generateSegmentOffers(
  segmentSummary: string,
  count = 3,
  keys?: { editKey?: string; marketingKey?: string },
): Promise<{ title: string; reason: string; body: string; contentId?: string; discount?: string }[]> {
  if (keys) resolveAccess(keys);
  const catalog = listCatalogPublic();
  const premium = catalog.items.filter((i) => !i.free).slice(0, 8);
  const apiKey = resolveDeepSeekApiKey();

  if (apiKey && premium.length) {
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: `Return JSON {"offers":[{"title":"","reason":"","body":"","contentId":"","discount":""}]} with ${count} segment-tailored offers.`,
            },
            {
              role: "user",
              content: `Audience:\n${segmentSummary}\n\nCatalog:\n${premium.map((p) => `${p.id}: ${p.title}`).join("\n")}`,
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 800,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as {
          offers?: { title: string; reason: string; body?: string; contentId?: string; discount?: string }[];
        };
        if (parsed.offers?.length) {
          return parsed.offers.slice(0, count).map((o) => ({
            title: o.title,
            reason: o.reason,
            body: o.body ?? o.reason,
            contentId: o.contentId,
            discount: o.discount,
          }));
        }
      }
    } catch { /* fallback */ }
  }

  const pick = premium[0];
  return [
    {
      title: pick ? `Unlock ${pick.title}` : "Special offer",
      reason: segmentSummary.slice(0, 120),
      body: segmentSummary.slice(0, 200),
      contentId: pick?.id,
    },
  ];
}
