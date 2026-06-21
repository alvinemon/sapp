import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { assertAdmin } from "./authKeys.js";
import { dataPath } from "./dataPath.js";
import { getPipelineClientConfig, isRemotePipeline, pipelineIngest } from "./pipelineClient.js";

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");

function pipelineData(...parts: string[]): string {
  return dataPath("pipeline", ...parts);
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function tailLog(name: string, lines = 80): string[] {
  const p = pipelineData("logs", `${name}.log`);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").slice(-lines).filter(Boolean);
}

function pythonBin(): string {
  const venv = join(PIPELINE_DIR, ".venv", "bin", "python3");
  if (existsSync(venv)) return venv;
  return process.env.PYTHON_BIN?.trim() || "python3";
}

export function parsePythonCliStdout(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) return { ok: true };
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].startsWith("{")) continue;
      try {
        return JSON.parse(lines[i]) as Record<string, unknown>;
      } catch {
        /* try previous line */
      }
    }
    return { ok: true, output: trimmed };
  }
}

function runPythonCli(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin(), ["cli.py", ...args], {
      cwd: PIPELINE_DIR,
      env: { ...process.env, PYTHONPATH: PIPELINE_DIR },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `pipeline exit ${code}`));
        return;
      }
      resolve(parsePythonCliStdout(stdout));
    });
  });
}

export async function runTorrentIngest(magnet: string, title = ""): Promise<Record<string, unknown>> {
  return pipelineIngest(magnet, title);
}

export interface PipelineCatalogItem {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  quality?: string;
  languages?: string[];
  telegram_file_id?: string;
  telegram_file_ids?: string[];
  uploaded_at?: string;
  early_access?: boolean;
  early_access_until?: string;
}

export function getPipelineStatus() {
  const state = readJsonFile<Record<string, unknown>>(pipelineData("state.json"), {});
  const master = readJsonFile<{ items: PipelineCatalogItem[] }>(pipelineData("master_catalog.json"), { items: [] });
  const uploadLog = readJsonFile<{ uploads: unknown[] }>(pipelineData("upload_log.json"), { uploads: [] });
  const urlPath = pipelineData("catalog_public_url.txt");
  const publicUrl = existsSync(urlPath) ? readFileSync(urlPath, "utf8").trim() : (state.catalog_public_url as string | undefined);

  const cfg = getPipelineClientConfig();
  return {
    lastPipeline: state.last_pipeline_run ?? null,
    lastIngest: state.last_ingest ?? null,
    lastProcess: state.last_process ?? null,
    lastPublish: state.last_publish ?? null,
    catalogCount: master.items?.length ?? 0,
    uploadCount: uploadLog.uploads?.length ?? 0,
    publicUrl: publicUrl ?? null,
    pipelineMode: cfg.mode,
    pipelineWorkerUrl: cfg.workerUrl || null,
    localDownloads: cfg.localDownloads,
    remotePipeline: isRemotePipeline(),
    paths: {
      incoming: pipelineData("incoming"),
      ready: pipelineData("ready"),
    },
  };
}

export function getPipelineCatalog(): { items: PipelineCatalogItem[]; generated_at?: string } {
  return readJsonFile(pipelineData("master_catalog.json"), { items: [] });
}

export function getPipelineLogs() {
  return ["pipeline", "ingest", "process", "telegram", "publish", "rss"].map((name) => ({
    name,
    lines: tailLog(name),
  }));
}

export async function runPipelineCycle(editKey?: string) {
  assertAdmin(editKey);
  return runPythonCli(["cycle"]);
}

export async function runPipelineStep(step: string, editKey?: string) {
  assertAdmin(editKey);
  const allowed = ["ingest", "process", "upload", "publish"];
  if (!allowed.includes(step)) throw new Error("invalid step");
  return runPythonCli([step]);
}

export async function setPipelineEarlyAccess(itemId: string, enabled: boolean, editKey?: string) {
  assertAdmin(editKey);
  return runPythonCli(["early-access", itemId, enabled ? "true" : "false"]);
}

export async function getPipelineRevenue(editKey?: string) {
  assertAdmin(editKey);
  return runPythonCli(["analytics"]);
}

export async function trainPricingModel(editKey?: string) {
  assertAdmin(editKey);
  return runPythonCli(["train"]);
}

export function getPipelineConfig() {
  const configPath = join(PIPELINE_DIR, "config.yaml");
  const examplePath = join(PIPELINE_DIR, "config.example.yaml");
  const exists = existsSync(configPath);
  const client = getPipelineClientConfig();
  return {
    configured: exists,
    configPath: exists ? configPath : examplePath,
    python: pythonBin(),
    pipelineDir: PIPELINE_DIR,
    mode: client.mode,
    workerUrl: client.workerUrl || null,
    localDownloads: client.localDownloads,
    remotePipeline: isRemotePipeline(),
  };
}

export function syncPipelineCatalog(body: { title?: string; items: Record<string, unknown>[] }) {
  const path = dataPath("catalog.json");
  const node = readJsonFile<{ title?: string; items: Record<string, unknown>[] }>(
    path,
    { title: "2hotatl", items: [] },
  );
  const existing = new Map<string, Record<string, unknown>>();
  for (const item of node.items) {
    if (item.source !== "telegram") existing.set(String(item.id), item);
  }
  for (const item of body.items) {
    existing.set(String(item.id), item);
  }
  node.items = [...existing.values()].sort(
    (a, b) => Number(b.addedAt ?? 0) - Number(a.addedAt ?? 0),
  );
  if (body.title) node.title = body.title;
  writeFileSync(path, `${JSON.stringify(node, null, 2)}\n`, "utf8");
  return { synced: body.items.length, total: node.items.length };
}
