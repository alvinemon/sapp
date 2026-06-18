import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateDevice, ensureDeviceRegistered, signup } from "./auth.js";
import { resolveDeepSeekApiKey, runAgent } from "./agent.js";
import { attachClient, listDevices, validateKey, status } from "./relay.js";
import { attachWatchClient, watchStatus } from "./watch.js";
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
app.get("/api/devices", (_req, res) => res.json({ devices: listDevices() }));
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
