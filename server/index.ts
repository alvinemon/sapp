import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateDevice, ensureDeviceRegistered, getUserByDeviceId, signup } from "./auth.js";
import { clearNotes, getNotes } from "./notes.js";
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
    const { name, account, instructions, editKey } = req.body ?? {};
    assertPaymentAdmin(typeof editKey === "string" ? editKey : undefined);
    const method = addPaymentMethod({
      name: String(name ?? ""),
      account: String(account ?? ""),
      instructions: String(instructions ?? ""),
    });
    res.json(method);
  } catch (e) {
    res.status(e instanceof Error && e.message === "Invalid edit key" ? 403 : 500).json({
      error: e instanceof Error ? e.message : "failed",
    });
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
app.post("/api/premium/request", (req, res) => {
  try {
    const { contentId, methodId, reference } = req.body ?? {};
    if (!contentId || !methodId || !reference) {
      res.status(400).json({ error: "contentId, methodId, reference required" });
      return;
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
    if (!prompt || !screen) {
      res.status(400).send("prompt and screen required");
      return;
    }
    const result = await runAgent(prompt, screen, history, apiKey);
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
});

process.on("uncaughtException", (err) => {
  console.error("[2hotatl] uncaughtException:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("[2hotatl] unhandledRejection:", err);
});
