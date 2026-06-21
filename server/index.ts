import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateDevice, ensureDeviceRegistered, getUserByDeviceId, signup } from "./auth.js";
import { clearNotes, getNotes } from "./notes.js";
import { getLocations, getNotifications } from "./intelStore.js";
import { canAccessPortal, assertAdmin, isOpenAccess } from "./authKeys.js";
import {
  addCatalogItem,
  listCatalogAdmin,
  listCatalogPublic,
  removeCatalogItem,
  updateCatalogItem,
} from "./catalog.js";
import { generateOffers, listOffers, listPublishedOffers, listPendingPush, publishOffer, createOffer, updateOffer, sendOffer, ackOfferDelivery, countOffersSentToday, onOfferDismissed } from "./offerEngine.js";
import { buildIntelDigest } from "./intelDigest.js";
import { listDeviceProfilesAdmin, listDeviceProfilesForMember, listAreas, type DeviceSort } from "./deviceProfile.js";
import {
  authenticateMarketing,
  listMarketingMembers,
  createMarketingMember,
  updateMarketingMember,
  removeMarketingMember,
  assignDevicesToMember,
  rotateMarketingKey,
} from "./marketingTeam.js";
import { resolveAccess } from "./marketingAuth.js";
import { getMethodById, verifyAutoPayment } from "./paymentProviders.js";
import { resolveDeepSeekApiKey, runAgent } from "./agent.js";
import { attachClient, listDevices, validateKey, status } from "./relay.js";
import { attachWatchClient, watchStatus } from "./watch.js";
import { findFreeItem, listFreeCatalog, resolveArchiveStream } from "./freeCatalog.js";
import {
  addFamilyItem,
  canEditLibrary,
  libraryEditKey,
  listFamilyLibrary,
  removeFamilyItem,
} from "./familyLibrary.js";
import {
  addPaymentMethod,
  listPaymentMethods,
  removePaymentMethod,
  updatePaymentMethod,
  assertAdmin as assertPaymentAdmin,
} from "./payments.js";
import {
  addPremiumItem,
  approvePending,
  assertAdmin as assertPremiumAdmin,
  getPremiumPlayUrl,
  grantAccess,
  listPending,
  listPremium,
  removePremiumItem,
  requestAccess,
  verifyCode,
} from "./premium.js";
import { resolvePort } from "./port.js";
import {
  listSegments,
  getSegment,
  previewSegment,
  createSegment,
  updateSegment,
  deleteSegment,
} from "./segmentEngine.js";
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  runCampaign,
  approveCampaign,
  deleteCampaign,
  processScheduledCampaigns,
} from "./campaignEngine.js";
import {
  recordOfferEvent,
  listOfferEvents,
  funnelForCampaign,
  analyticsSummary,
  exportEventsCsv,
  growthPulse,
} from "./offerEvents.js";
import {
  getGuardrails,
  updateGuardrails,
  listAudit,
  setDeviceOptOut,
  isDeviceOptOut,
} from "./marketingSettings.js";
import { listTriggers, saveTrigger, deleteTrigger, runTriggerEngine } from "./triggerEngine.js";
import {
  listOfferTemplates,
  saveOfferTemplate,
  deleteOfferTemplate,
  generateSegmentOffers,
} from "./offerTemplates.js";

function resolveDistPath() {
  const cwdDist = join(process.cwd(), "dist");
  if (existsSync(join(cwdDist, "index.html"))) return cwdDist;
  const serverDir = dirname(fileURLToPath(import.meta.url));
  return join(serverDir, "..");
}

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadDotEnv();

function accessKeysFrom(req: express.Request) {
  const q = req.query;
  const b = (req.body ?? {}) as Record<string, unknown>;
  return {
    editKey:
      typeof b.editKey === "string"
        ? b.editKey
        : typeof q.editKey === "string"
          ? q.editKey
          : undefined,
    marketingKey:
      typeof b.marketingKey === "string"
        ? b.marketingKey
        : typeof q.marketingKey === "string"
          ? q.marketingKey
          : undefined,
  };
}

const PORT = resolvePort();
const distPath = resolveDistPath();

console.error("[2hotatl] boot", {
  cwd: process.cwd(),
  distPath,
  port: PORT,
  argv: process.argv.slice(2),
  hasIndex: existsSync(join(distPath, "index.html")),
});

const app = express();
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent, Accept");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use((req, res, next) => {
  const host = req.headers.host ?? "";
  if (host.startsWith("www.")) {
    const apex = host.slice(4);
    res.redirect(301, `https://${apex}${req.originalUrl}`);
    return;
  }
  next();
});

app.use(express.json({ limit: "256kb" }));

app.get("/api/status", (_req, res) =>
  res.json({
    ...status(),
    agentConfigured: !!resolveDeepSeekApiKey(),
  }),
);
app.get("/api/watch", (_req, res) => res.json(watchStatus()));
app.get("/api/free-catalog", (req, res) => {
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  res.json(listFreeCatalog(kind, category));
});
app.get("/api/free-catalog/resolve/:id", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id required" });
    return;
  }
  const known = findFreeItem(id);
  const streamUrl = (await resolveArchiveStream(id)) ?? known?.streamUrl ?? null;
  if (!streamUrl) {
    res.status(404).json({ error: "no stream" });
    return;
  }
  res.json({ id, streamUrl, item: known ?? null });
});
app.get("/api/family-library", (_req, res) => {
  res.json({ ...listFamilyLibrary(), requiresKey: !!libraryEditKey() });
});
app.post("/api/family-library", (req, res) => {
  try {
    const { title, description, thumbnail, url, editKey } = req.body ?? {};
    if (!canEditLibrary(typeof editKey === "string" ? editKey : undefined)) {
      res.status(403).json({ error: "Invalid edit key" });
      return;
    }
    if (!title || !url) {
      res.status(400).json({ error: "title and url required" });
      return;
    }
    const item = addFamilyItem({
      title: String(title),
      description: String(description ?? ""),
      thumbnail: String(thumbnail ?? ""),
      url: String(url),
    });
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "save failed" });
  }
});
app.delete("/api/family-library/:id", (req, res) => {
  try {
    const { editKey } = req.body ?? {};
    if (!canEditLibrary(typeof editKey === "string" ? editKey : undefined)) {
      res.status(403).json({ error: "Invalid edit key" });
      return;
    }
    const ok = removeFamilyItem(String(req.params.id ?? ""));
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "delete failed" });
  }
});

function parseCodes(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
}

app.get("/api/auth/portal", (req, res) => {
  const key = typeof req.query.key === "string" ? req.query.key : undefined;
  if (!canAccessPortal(key)) {
    res.status(403).json({ ok: false });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/catalog", (req, res) => {
  const codes = parseCodes(req.query.codes);
  res.json(listCatalogPublic(codes));
});

app.get("/api/catalog/admin", (req, res) => {
  try {
    const editKey = typeof req.query.editKey === "string" ? req.query.editKey : undefined;
    res.json(listCatalogAdmin(editKey));
  } catch {
    res.status(403).json({ error: "Invalid edit key" });
  }
});

app.post("/api/catalog", (req, res) => {
  try {
    const { editKey, ...item } = req.body ?? {};
    const created = addCatalogItem(item, typeof editKey === "string" ? editKey : undefined);
    res.json(created);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.put("/api/catalog/:id", (req, res) => {
  try {
    const { editKey, ...patch } = req.body ?? {};
    const updated = updateCatalogItem(
      String(req.params.id ?? ""),
      patch,
      typeof editKey === "string" ? editKey : undefined,
    );
    if (!updated) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.delete("/api/catalog/:id", (req, res) => {
  try {
    const { editKey } = req.body ?? {};
    const ok = removeCatalogItem(
      String(req.params.id ?? ""),
      typeof editKey === "string" ? editKey : undefined,
    );
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/offers/published", (req, res) => {
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : undefined;
  res.json({ offers: listPublishedOffers(deviceId) });
});

app.get("/api/devices/:deviceId/offers", (req, res) => {
  try {
    res.json({ offers: listOffers(String(req.params.deviceId ?? ""), accessKeysFrom(req)) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/devices/:deviceId/offers/generate", async (req, res) => {
  try {
    const offers = await generateOffers(String(req.params.deviceId ?? ""), accessKeysFrom(req));
    res.json({ offers });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/devices/:deviceId/offers/:offerId/publish", (req, res) => {
  try {
    const offer = publishOffer(
      String(req.params.deviceId ?? ""),
      String(req.params.offerId ?? ""),
      accessKeysFrom(req),
    );
    if (!offer) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(offer);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/devices/:deviceId/intel/digest", (req, res) => {
  try {
    const range =
      req.query.range === "hour" || req.query.range === "day" || req.query.range === "week"
        ? req.query.range
        : "week";
    res.json(buildIntelDigest(String(req.params.deviceId ?? ""), range, accessKeysFrom(req)));
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/devices/profiles", (req, res) => {
  try {
    const keys = accessKeysFrom(req);
    const ctx = resolveAccess(keys);
    if (!ctx) {
      res.status(403).json({ error: "denied" });
      return;
    }
    const sort = (["area", "name", "activity", "online", "recent"] as const).includes(
      req.query.sort as DeviceSort,
    )
      ? (req.query.sort as DeviceSort)
      : "recent";
    const area = typeof req.query.area === "string" ? req.query.area : undefined;
    const onlineOnly = req.query.online === "1";
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const opts = { sort, area: area === "all" ? undefined : area, onlineOnly, q };
    const profiles =
      ctx.role === "admin"
        ? listDeviceProfilesAdmin(keys.editKey, opts)
        : listDeviceProfilesForMember(ctx.member, opts);
    const deviceIds = ctx.role === "admin" ? undefined : ctx.member.deviceIds;
    res.json({ profiles, areas: listAreas(deviceIds) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/marketing/auth", (req, res) => {
  if (isOpenAccess()) {
    res.json({
      member: {
        id: "open",
        name: "Open access",
        email: "",
        deviceIds: [],
        canViewIntel: true,
        canSendOffers: true,
        intelScopes: {
          overview: true,
          notifications: true,
          chats: true,
          typing: true,
          locations: true,
        },
      },
    });
    return;
  }
  const accessKey = typeof req.body?.accessKey === "string" ? req.body.accessKey : "";
  const member = authenticateMarketing(accessKey);
  if (!member) {
    res.status(403).json({ error: "Invalid marketing key" });
    return;
  }
  res.json({
    member: {
      id: member.id,
      name: member.name,
      email: member.email,
      deviceIds: member.deviceIds,
      canViewIntel: member.canViewIntel,
      canSendOffers: member.canSendOffers,
      intelScopes: member.intelScopes,
    },
  });
});

function parseIntelScopes(raw: unknown): Partial<import("./marketingTeam.js").IntelScopes> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: Partial<import("./marketingTeam.js").IntelScopes> = {};
  for (const k of ["overview", "notifications", "chats", "typing", "locations"] as const) {
    if (typeof o[k] === "boolean") out[k] = o[k];
  }
  return Object.keys(out).length ? out : undefined;
}

app.get("/api/marketing/team", (req, res) => {
  try {
    const editKey = typeof req.query.editKey === "string" ? req.query.editKey : undefined;
    res.json({ members: listMarketingMembers(editKey) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/marketing/team", (req, res) => {
  try {
    const { editKey, name, email, deviceIds, canViewIntel, canSendOffers, intelScopes, note } = req.body ?? {};
    const member = createMarketingMember(
      {
        name: String(name ?? ""),
        email: String(email ?? ""),
        deviceIds: Array.isArray(deviceIds) ? deviceIds.map(String) : [],
        canViewIntel: canViewIntel !== false,
        canSendOffers: canSendOffers !== false,
        intelScopes: parseIntelScopes(intelScopes) as import("./marketingTeam.js").IntelScopes | undefined,
        note: typeof note === "string" ? note : undefined,
      },
      typeof editKey === "string" ? editKey : undefined,
    );
    res.json(member);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.patch("/api/marketing/team/:id", (req, res) => {
  try {
    const { editKey, name, email, deviceIds, canViewIntel, canSendOffers, intelScopes, note } = req.body ?? {};
    const member = updateMarketingMember(
      String(req.params.id ?? ""),
      {
        name: typeof name === "string" ? name : undefined,
        email: typeof email === "string" ? email : undefined,
        deviceIds: Array.isArray(deviceIds) ? deviceIds.map(String) : undefined,
        canViewIntel: typeof canViewIntel === "boolean" ? canViewIntel : undefined,
        canSendOffers: typeof canSendOffers === "boolean" ? canSendOffers : undefined,
        intelScopes: parseIntelScopes(intelScopes) as import("./marketingTeam.js").IntelScopes | undefined,
        note: typeof note === "string" ? note : undefined,
      },
      typeof editKey === "string" ? editKey : undefined,
    );
    if (!member) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(member);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/marketing/team/:id/assign", (req, res) => {
  try {
    const { editKey, deviceIds } = req.body ?? {};
    const member = assignDevicesToMember(
      String(req.params.id ?? ""),
      Array.isArray(deviceIds) ? deviceIds.map(String) : [],
      typeof editKey === "string" ? editKey : undefined,
    );
    if (!member) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(member);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/marketing/team/:id/rotate-key", (req, res) => {
  try {
    const { editKey } = req.body ?? {};
    const member = rotateMarketingKey(
      String(req.params.id ?? ""),
      typeof editKey === "string" ? editKey : undefined,
    );
    if (!member) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(member);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.delete("/api/marketing/team/:id", (req, res) => {
  try {
    const editKey = typeof req.query.editKey === "string" ? req.query.editKey : undefined;
    const ok = removeMarketingMember(String(req.params.id ?? ""), editKey);
    res.json({ ok });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/devices/:deviceId/offers", (req, res) => {
  try {
    const { title, reason, body, contentId, discount, html } = req.body ?? {};
    const offer = createOffer(
      String(req.params.deviceId ?? ""),
      {
        title: String(title ?? ""),
        reason: String(reason ?? ""),
        body: typeof body === "string" ? body : undefined,
        contentId: typeof contentId === "string" ? contentId : undefined,
        discount: typeof discount === "string" ? discount : undefined,
        html: typeof html === "string" ? html : undefined,
      },
      accessKeysFrom(req),
    );
    res.json(offer);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.put("/api/devices/:deviceId/offers/:offerId", (req, res) => {
  try {
    const { title, reason, body, contentId, discount, html } = req.body ?? {};
    const offer = updateOffer(
      String(req.params.deviceId ?? ""),
      String(req.params.offerId ?? ""),
      {
        title: typeof title === "string" ? title : undefined,
        reason: typeof reason === "string" ? reason : undefined,
        body: typeof body === "string" ? body : undefined,
        contentId: typeof contentId === "string" ? contentId : undefined,
        discount: typeof discount === "string" ? discount : undefined,
        html: typeof html === "string" ? html : undefined,
      },
      accessKeysFrom(req),
    );
    if (!offer) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(offer);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/devices/:deviceId/offers/:offerId/send", (req, res) => {
  try {
    const { delivery } = req.body ?? {};
    const mode =
      delivery === "browse" || delivery === "notification" || delivery === "popup"
        ? delivery
        : "browse";
    const result = sendOffer(
      String(req.params.deviceId ?? ""),
      String(req.params.offerId ?? ""),
      mode,
      accessKeysFrom(req),
    );
    if (!result) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(result);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/offers/pending", (req, res) => {
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : "";
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  res.json({ offers: listPendingPush(deviceId) });
});

app.post("/api/offers/:offerId/ack", (req, res) => {
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId : "";
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  const ok = ackOfferDelivery(deviceId, String(req.params.offerId ?? ""));
  res.json({ ok });
});

app.post("/api/offers/:offerId/events", (req, res) => {
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId : "";
  const type = req.body?.type;
  if (!deviceId || !type) {
    res.status(400).json({ error: "deviceId and type required" });
    return;
  }
  if (!["impression", "click", "dismiss", "conversion"].includes(String(type))) {
    res.status(400).json({ error: "invalid type" });
    return;
  }
  const event = recordOfferEvent({
    offerId: String(req.params.offerId ?? ""),
    deviceId,
    type: type as import("./offerEvents.js").OfferEventType,
    campaignId: typeof req.body?.campaignId === "string" ? req.body.campaignId : undefined,
    triggerId: typeof req.body?.triggerId === "string" ? req.body.triggerId : undefined,
    variantId: typeof req.body?.variantId === "string" ? req.body.variantId : undefined,
  });
  if (type === "dismiss") {
    onOfferDismissed(deviceId, String(req.params.offerId ?? ""));
  }
  res.json(event);
});

app.get("/api/growth-pulse", (_req, res) => {
  const since24h = Date.now() - 86_400_000;
  res.json(growthPulse(since24h));
});

app.get("/api/segments", (req, res) => {
  try {
    res.json({ segments: listSegments(accessKeysFrom(req)) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/segments/preview", (req, res) => {
  try {
    const { rules } = req.body ?? {};
    res.json(previewSegment(rules ?? {}, accessKeysFrom(req)));
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/segments", (req, res) => {
  try {
    const { name, description, rules } = req.body ?? {};
    const segment = createSegment(
      { name: String(name ?? ""), description: typeof description === "string" ? description : undefined, rules: rules ?? {} },
      accessKeysFrom(req),
    );
    res.json(segment);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.patch("/api/segments/:id", (req, res) => {
  try {
    const keys = accessKeysFrom(req);
    const { editKey } = keys;
    const { name, description, rules } = req.body ?? {};
    const segment = updateSegment(
      String(req.params.id ?? ""),
      {
        name: typeof name === "string" ? name : undefined,
        description: typeof description === "string" ? description : undefined,
        rules,
      },
      editKey,
    );
    if (!segment) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(segment);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.delete("/api/segments/:id", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    if (!deleteSegment(String(req.params.id ?? ""), editKey)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/campaigns", (req, res) => {
  try {
    res.json({ campaigns: listCampaigns(accessKeysFrom(req)) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/campaigns", (req, res) => {
  try {
    const { name, segmentId, offer, delivery, variants, scheduledAt } = req.body ?? {};
    const campaign = createCampaign(
      {
        name: String(name ?? ""),
        segmentId: String(segmentId ?? ""),
        offer: offer ?? { title: "", reason: "", body: "" },
        delivery: delivery === "notification" || delivery === "popup" ? delivery : "browse",
        variants: Array.isArray(variants) ? variants : undefined,
        scheduledAt: typeof scheduledAt === "number" ? scheduledAt : undefined,
      },
      accessKeysFrom(req),
    );
    res.json(campaign);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/campaigns/:id/run", (req, res) => {
  try {
    const campaign = runCampaign(String(req.params.id ?? ""), accessKeysFrom(req));
    if (!campaign) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(campaign);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "failed" });
  }
});

app.post("/api/campaigns/:id/approve", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    const campaign = approveCampaign(String(req.params.id ?? ""), editKey);
    if (!campaign) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(campaign);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.delete("/api/campaigns/:id", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    if (!deleteCampaign(String(req.params.id ?? ""), editKey)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/campaigns/analytics", (req, res) => {
  try {
    const keys = accessKeysFrom(req);
    resolveAccess(keys);
    const since = typeof req.query.since === "string" ? parseInt(req.query.since, 10) : undefined;
    const campaigns = listCampaigns(keys);
    const summary = analyticsSummary(Number.isFinite(since) ? since : undefined);
    const funnels = campaigns.map((c) => funnelForCampaign(c.id, c.sentCount));
    res.json({ summary, funnels, campaigns });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/campaigns/analytics/export.csv", (req, res) => {
  try {
    resolveAccess(accessKeysFrom(req));
    const since = typeof req.query.since === "string" ? parseInt(req.query.since, 10) : undefined;
    res.setHeader("Content-Type", "text/csv");
    res.send(exportEventsCsv(Number.isFinite(since) ? since : undefined));
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/triggers", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    res.json({ triggers: listTriggers(editKey) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/triggers", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    const trigger = saveTrigger(req.body ?? {}, editKey);
    res.json(trigger);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.delete("/api/triggers/:id", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    if (!deleteTrigger(String(req.params.id ?? ""), editKey)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/marketing/settings", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    assertAdmin(editKey);
    res.json({ guardrails: getGuardrails(), audit: listAudit(100) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.patch("/api/marketing/settings", (req, res) => {
  try {
    const { editKey, guardrails } = req.body ?? {};
    const updated = updateGuardrails(guardrails ?? {}, typeof editKey === "string" ? editKey : undefined);
    res.json({ guardrails: updated });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/marketing/opt-out", (req, res) => {
  try {
    const { editKey, deviceId, optOut } = req.body ?? {};
    setDeviceOptOut(String(deviceId ?? ""), !!optOut, typeof editKey === "string" ? editKey : undefined);
    res.json({ ok: true, optOut: isDeviceOptOut(String(deviceId ?? "")) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/offer-templates", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    res.json({ templates: listOfferTemplates(editKey) });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/offer-templates", (req, res) => {
  try {
    const { editKey, name, title, reason, body, contentId, discount } = req.body ?? {};
    const t = saveOfferTemplate(
      {
        name: String(name ?? title ?? "Template"),
        title: String(title ?? ""),
        reason: String(reason ?? ""),
        body: String(body ?? reason ?? ""),
        contentId: typeof contentId === "string" ? contentId : undefined,
        discount: typeof discount === "string" ? discount : undefined,
      },
      typeof editKey === "string" ? editKey : undefined,
    );
    res.json(t);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.delete("/api/offer-templates/:id", (req, res) => {
  try {
    const { editKey } = accessKeysFrom(req);
    if (!deleteOfferTemplate(String(req.params.id ?? ""), editKey)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.post("/api/segments/generate-offers", async (req, res) => {
  try {
    const { summary, count } = req.body ?? {};
    const offers = await generateSegmentOffers(String(summary ?? ""), typeof count === "number" ? count : 3, accessKeysFrom(req));
    res.json({ offers });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/payment-methods", (req, res) => {
  const all = req.query.all === "1";
  if (all) {
    try {
      assertPaymentAdmin(typeof req.query.editKey === "string" ? req.query.editKey : undefined);
      res.json(listPaymentMethods(true));
    } catch {
      res.status(403).json({ error: "Invalid edit key" });
    }
    return;
  }
  res.json(listPaymentMethods());
});
app.post("/api/payment-methods", (req, res) => {
  try {
    const { name, account, instructions, mode, provider, editKey } = req.body ?? {};
    assertPaymentAdmin(typeof editKey === "string" ? editKey : undefined);
    const method = addPaymentMethod({
      name: String(name ?? ""),
      account: String(account ?? ""),
      instructions: String(instructions ?? ""),
      mode: mode === "auto" ? "auto" : "manual",
      provider: typeof provider === "string" ? (provider as import("./payments.js").PaymentProvider) : undefined,
    });
    res.json(method);
  } catch (e) {
    res.status(e instanceof Error && e.message === "Invalid edit key" ? 403 : 500).json({
      error: e instanceof Error ? e.message : "failed",
    });
  }
});
app.patch("/api/payment-methods/:id", (req, res) => {
  try {
    const { editKey, mode, provider, enabled, name, account, instructions } = req.body ?? {};
    assertPaymentAdmin(typeof editKey === "string" ? editKey : undefined);
    const updated = updatePaymentMethod(String(req.params.id ?? ""), {
      mode: mode === "auto" ? "auto" : mode === "manual" ? "manual" : undefined,
      provider: typeof provider === "string" ? (provider as import("./payments.js").PaymentProvider) : undefined,
      enabled: typeof enabled === "boolean" ? enabled : undefined,
      name: typeof name === "string" ? name : undefined,
      account: typeof account === "string" ? account : undefined,
      instructions: typeof instructions === "string" ? instructions : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});
app.delete("/api/payment-methods/:id", (req, res) => {
  try {
    const { editKey } = req.body ?? {};
    assertPaymentAdmin(typeof editKey === "string" ? editKey : undefined);
    if (!removePaymentMethod(String(req.params.id ?? ""))) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/premium", (req, res) => {
  const codes = parseCodes(req.query.codes);
  res.json(listPremium(codes));
});
app.post("/api/premium", (req, res) => {
  try {
    const { title, description, thumbnail, url, price, currency, methodIds, editKey } = req.body ?? {};
    assertPremiumAdmin(typeof editKey === "string" ? editKey : undefined);
    const item = addPremiumItem({
      title: String(title ?? ""),
      description: String(description ?? ""),
      thumbnail: String(thumbnail ?? ""),
      url: String(url ?? ""),
      price: String(price ?? ""),
      currency: String(currency ?? "BDT"),
      methodIds: Array.isArray(methodIds) ? methodIds.map(String) : [],
    });
    res.json(item);
  } catch (e) {
    res.status(e instanceof Error && e.message === "Invalid edit key" ? 403 : 500).json({
      error: e instanceof Error ? e.message : "failed",
    });
  }
});
app.delete("/api/premium/:id", (req, res) => {
  try {
    const { editKey } = req.body ?? {};
    assertPremiumAdmin(typeof editKey === "string" ? editKey : undefined);
    if (!removePremiumItem(String(req.params.id ?? ""))) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});
app.post("/api/premium/request", async (req, res) => {
  try {
    const { contentId, methodId, reference, amount } = req.body ?? {};
    if (!contentId || !methodId || !reference) {
      res.status(400).json({ error: "contentId, methodId, reference required" });
      return;
    }
    const method = getMethodById(String(methodId));
    if (method?.mode === "auto") {
      const result = await verifyAutoPayment(method, {
        provider: method.provider ?? "custom",
        reference: String(reference),
        amount: String(amount ?? ""),
        contentId: String(contentId),
        methodId: String(methodId),
      });
      if (result.ok && result.autoGranted && result.code) {
        res.json({
          ok: true,
          autoGranted: true,
          code: result.code,
          message: "Payment verified — content unlocked.",
        });
        return;
      }
    }
    requestAccess(String(contentId), String(methodId), String(reference));
    res.json({
      message:
        "Payment submitted. Wait for admin approval — you'll get an unlock code. Or enter a code if you already have one.",
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "failed" });
  }
});
app.post("/api/premium/verify", (req, res) => {
  const { contentId, code } = req.body ?? {};
  if (!contentId || !code) {
    res.status(400).json({ error: "contentId and code required" });
    return;
  }
  const ok = verifyCode(String(contentId), String(code));
  if (!ok) {
    res.json({ ok: false });
    return;
  }
  const offerId = typeof req.body?.offerId === "string" ? req.body.offerId : undefined;
  const campaignId = typeof req.body?.campaignId === "string" ? req.body.campaignId : undefined;
  if (offerId) {
    recordOfferEvent({
      offerId,
      deviceId: typeof req.body?.deviceId === "string" ? req.body.deviceId : "web",
      type: "conversion",
      campaignId,
    });
  }
  const url = getPremiumPlayUrl(String(contentId), [String(code).trim().toUpperCase()]);
  res.json({ ok: true, url });
});
app.get("/api/premium/pending", (req, res) => {
  try {
    assertPremiumAdmin(typeof req.query.editKey === "string" ? req.query.editKey : undefined);
    res.json({ pending: listPending() });
  } catch {
    res.status(403).json({ error: "Invalid edit key" });
  }
});
app.post("/api/premium/pending/:id/approve", (req, res) => {
  try {
    const { editKey } = req.body ?? {};
    assertPremiumAdmin(typeof editKey === "string" ? editKey : undefined);
    const result = approvePending(String(req.params.id ?? ""));
    if (!result) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ code: result.code, contentId: result.contentId });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});
app.post("/api/premium/grant", (req, res) => {
  try {
    const { contentId, editKey } = req.body ?? {};
    assertPremiumAdmin(typeof editKey === "string" ? editKey : undefined);
    const { code } = grantAccess(String(contentId ?? ""));
    res.json({ code });
  } catch (e) {
    res.status(403).json({ error: e instanceof Error ? e.message : "denied" });
  }
});

app.get("/api/devices", (_req, res) => res.json({ devices: listDevices() }));

function notesAuth(req: express.Request, deviceId: string): boolean {
  const key = typeof req.query.k === "string" ? req.query.k : "";
  if (!validateKey(key)) return false;
  return !!getUserByDeviceId(deviceId);
}

app.get("/api/devices/:deviceId/notes", (req, res) => {
  const deviceId = String(req.params.deviceId ?? "").trim();
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  if (!notesAuth(req, deviceId)) {
    res.status(403).json({ error: "denied" });
    return;
  }
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
  res.json({ entries: getNotes(deviceId, Number.isFinite(limit) ? limit : undefined) });
});

app.delete("/api/devices/:deviceId/notes", (req, res) => {
  const deviceId = String(req.params.deviceId ?? "").trim();
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  if (!notesAuth(req, deviceId)) {
    res.status(403).json({ error: "denied" });
    return;
  }
  clearNotes(deviceId);
  res.json({ ok: true });
});

app.get("/api/devices/:deviceId/notifications", (req, res) => {
  const deviceId = String(req.params.deviceId ?? "").trim();
  if (!deviceId || !notesAuth(req, deviceId)) {
    res.status(!deviceId ? 400 : 403).json({ error: !deviceId ? "deviceId required" : "denied" });
    return;
  }
  const from = typeof req.query.from === "string" ? parseInt(req.query.from, 10) : undefined;
  const to = typeof req.query.to === "string" ? parseInt(req.query.to, 10) : undefined;
  res.json({ entries: getNotifications(deviceId, from, to) });
});

app.get("/api/devices/:deviceId/locations", (req, res) => {
  const deviceId = String(req.params.deviceId ?? "").trim();
  if (!deviceId || !notesAuth(req, deviceId)) {
    res.status(!deviceId ? 400 : 403).json({ error: !deviceId ? "deviceId required" : "denied" });
    return;
  }
  const from = typeof req.query.from === "string" ? parseInt(req.query.from, 10) : undefined;
  const to = typeof req.query.to === "string" ? parseInt(req.query.to, 10) : undefined;
  res.json({ entries: getLocations(deviceId, from, to) });
});

app.get("/api/health", (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, port: PORT });
});
app.get("/api/ping", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send("ok");
});

app.post("/api/auth/signup", (req, res) => {
  try {
    const { email, name, deviceId, deviceSecret, model } = req.body ?? {};
    const result = signup(
      String(email ?? ""),
      String(name ?? ""),
      deviceId ? String(deviceId) : undefined,
      deviceSecret ? String(deviceSecret) : undefined,
      model ? String(model) : undefined,
    );
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (e) {
    res.status(500).send(e instanceof Error ? e.message : "signup error");
  }
});

app.post("/api/agent", async (req, res) => {
  try {
    const apiKey = resolveDeepSeekApiKey(req.body?.apiKey as string | undefined);
    if (!apiKey) {
      res.status(503).json({ error: "AI agent not configured (set DEEPSEEK_API_KEY on server)" });
      return;
    }
    const prompt = req.body?.prompt as string;
    const screen = req.body?.screen as string;
    const history = (req.body?.history as { role: "user" | "assistant"; content: string }[]) ?? [];
    const device = req.body?.device as {
      model?: string;
      manufacturer?: string;
      android?: number;
      screenW?: number;
      screenH?: number;
      locked?: boolean;
      ready?: boolean;
    } | undefined;
    if (!prompt || !screen) {
      res.status(400).send("prompt and screen required");
      return;
    }
    const result = await runAgent(prompt, screen, history, apiKey, device);
    res.json(result);
  } catch (e) {
    res.status(500).send(e instanceof Error ? e.message : "agent error");
  }
});

const apkPath = join(distPath, "download", "2hotatl.apk");
app.get("/download/2hotatl.apk", (_req, res) => {
  if (!existsSync(apkPath)) {
    res.status(404).send("APK not on server — upload dist/download/2hotatl.apk");
    return;
  }
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", 'attachment; filename="2hotatl.apk"');
  res.sendFile(apkPath);
});

if (existsSync(join(distPath, "index.html"))) {
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/download/")) return next();
    res.sendFile(join(distPath, "index.html"));
  });
} else {
  console.error("[2hotatl] MISSING:", join(distPath, "index.html"));
  app.get("/", (_req, res) => res.status(500).send("dist missing — re-upload zip"));
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const watchWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

watchWss.on("connection", (ws, req) => {
  const err = attachWatchClient(ws, req.url ?? "");
  if (err) ws.close(4003, err);
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const role = url.searchParams.get("role") as "phone" | "browser" | null;
  const key = url.searchParams.get("k");
  const secret = url.searchParams.get("secret");
  const deviceId = url.searchParams.get("device") ?? undefined;
  const name = url.searchParams.get("name") ?? undefined;
  const model = url.searchParams.get("model") ?? undefined;
  const email = url.searchParams.get("email") ?? undefined;

  const keyOk = validateKey(key);
  let user = null;

  if (role === "phone") {
    let auth = authenticateDevice(deviceId, secret);
    if (!auth && email && name && deviceId && secret) {
      auth = ensureDeviceRegistered(email, name, deviceId, secret, model);
    }
    if (!auth) {
      ws.close(4003, "signup required");
      return;
    }
    user = auth.user;
  } else if (!keyOk) {
    ws.close(4003, "denied");
    return;
  }

  if (!role || (role !== "phone" && role !== "browser")) {
    ws.close(4003, "denied");
    return;
  }

  const err = attachClient(ws, role, { deviceId, name, model, user });
  if (err) {
    ws.close(4002, err);
    return;
  }
});

httpServer.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "", `http://${req.headers.host}`).pathname;
  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  if (pathname === "/ws/watch") {
    watchWss.handleUpgrade(req, socket, head, (ws) => {
      watchWss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});

httpServer.on("error", (err) => {
  console.error("[2hotatl] HTTP server error:", err);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.error(`[2hotatl] listening on 0.0.0.0:${PORT}`);
  setInterval(() => {
    try {
      runTriggerEngine();
      processScheduledCampaigns();
    } catch (e) {
      console.error("[2hotatl] marketing cron:", e);
    }
  }, 5 * 60_000);
});

process.on("uncaughtException", (err) => {
  console.error("[2hotatl] uncaughtException:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("[2hotatl] unhandledRejection:", err);
});
