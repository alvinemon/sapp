import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { parse as parseYaml } from "yaml";

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");

export type PipelineMode = "local" | "remote";

export interface PipelineClientConfig {
  mode: PipelineMode;
  workerUrl: string;
  workerSecret: string;
  localDownloads: boolean;
}

export interface AutomationConfig {
  maxConcurrentJobs: number;
  maxQueueSize: number;
  maxIngestsPerScan: number;
  maxJobRetries: number;
  jobPollIntervalSeconds: number;
  relayRssEnabled: boolean;
}

const DEFAULT_AUTOMATION: AutomationConfig = {
  maxConcurrentJobs: 1,
  maxQueueSize: 50,
  maxIngestsPerScan: 5,
  maxJobRetries: 3,
  jobPollIntervalSeconds: 60,
  relayRssEnabled: false,
};

function readYamlRoot(): Record<string, unknown> {
  const configPath = join(PIPELINE_DIR, "config.yaml");
  const examplePath = join(PIPELINE_DIR, "config.example.yaml");
  const path = existsSync(configPath) ? configPath : examplePath;
  if (!existsSync(path)) return {};
  try {
    return parseYaml(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readYamlPipelineSection(): Record<string, unknown> {
  return (readYamlRoot().pipeline ?? {}) as Record<string, unknown>;
}

export function loadAutomationConfig(): AutomationConfig {
  const auto = (readYamlRoot().automation ?? {}) as Record<string, unknown>;
  return {
    maxConcurrentJobs: Number(auto.max_concurrent_jobs ?? DEFAULT_AUTOMATION.maxConcurrentJobs),
    maxQueueSize: Number(auto.max_queue_size ?? DEFAULT_AUTOMATION.maxQueueSize),
    maxIngestsPerScan: Number(auto.max_ingests_per_scan ?? DEFAULT_AUTOMATION.maxIngestsPerScan),
    maxJobRetries: Number(auto.max_job_retries ?? DEFAULT_AUTOMATION.maxJobRetries),
    jobPollIntervalSeconds: Number(
      auto.job_poll_interval_seconds ?? DEFAULT_AUTOMATION.jobPollIntervalSeconds,
    ),
    relayRssEnabled: auto.relay_rss_enabled === true,
  };
}

export function getPipelineClientConfig(): PipelineClientConfig {
  const yaml = readYamlPipelineSection();
  const envMode = process.env.PIPELINE_MODE?.trim();
  const envWorker = process.env.PIPELINE_WORKER_URL?.trim() ?? "";
  const envWorkerHost = process.env.PIPELINE_WORKER_HOST?.trim() ?? "";
  const envSecret = process.env.PIPELINE_WORKER_SECRET?.trim() ?? "";
  const envLocal = process.env.PIPELINE_LOCAL_DOWNLOADS?.trim();

  const workerUrl =
    envWorker ||
    (envWorkerHost ? `https://${envWorkerHost.replace(/^https?:\/\//, "")}` : "") ||
    String(yaml.worker_url ?? "").trim();
  const mode: PipelineMode =
    envMode === "remote" || envMode === "local"
      ? envMode
      : workerUrl
        ? "remote"
        : String(yaml.mode ?? "remote") === "local"
          ? "local"
          : "remote";

  const localDownloads =
    envLocal === "true"
      ? true
      : envLocal === "false"
        ? false
        : yaml.local_downloads === true;

  return {
    mode,
    workerUrl,
    workerSecret: envSecret || String(yaml.worker_secret ?? "").trim(),
    localDownloads,
  };
}

function workerHeaders(): Record<string, string> {
  const cfg = getPipelineClientConfig();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.workerSecret) headers.Authorization = `Bearer ${cfg.workerSecret}`;
  return headers;
}

function workerBase(): string {
  const cfg = getPipelineClientConfig();
  if (!cfg.workerUrl) throw new Error("PIPELINE_WORKER_URL not set");
  return cfg.workerUrl.replace(/\/$/, "");
}

export function workerConfigured(): boolean {
  return !!getPipelineClientConfig().workerUrl;
}

export async function checkWorkerHealth(): Promise<{ ok: boolean; detail?: string }> {
  const cfg = getPipelineClientConfig();
  if (!cfg.workerUrl) return { ok: false, detail: "worker_url not configured" };
  try {
    const res = await fetch(`${cfg.workerUrl.replace(/\/$/, "")}/health`, {
      headers: workerHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, detail: String(body.detail ?? `HTTP ${res.status}`) };
    return { ok: body.ok === true, detail: String(body.service ?? "worker") };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function pythonBin(): string {
  const venv = join(PIPELINE_DIR, ".venv", "bin", "python3");
  if (existsSync(venv)) return venv;
  return process.env.PYTHON_BIN?.trim() || "python3";
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
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({ ok: true });
        return;
      }
      try {
        resolve(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (!lines[i].startsWith("{")) continue;
          try {
            resolve(JSON.parse(lines[i]) as Record<string, unknown>);
            return;
          } catch { /* continue */ }
        }
        resolve({ ok: true, output: trimmed });
      }
    });
  });
}

export async function fetchWorkerJobStatus(jobId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${workerBase()}/jobs/${encodeURIComponent(jobId)}`, {
    headers: workerHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(body.detail ?? body.error ?? `Worker HTTP ${res.status}`));
  }
  return body;
}

export async function fetchWorkerStats(): Promise<Record<string, unknown>> {
  const res = await fetch(`${workerBase()}/stats`, {
    headers: workerHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(body.detail ?? body.error ?? `Worker HTTP ${res.status}`));
  }
  return body;
}

export async function remoteIngest(url: string, title = ""): Promise<Record<string, unknown>> {
  const res = await fetch(`${workerBase()}/ingest`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({ url, title }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 429) {
    throw new Error(`Worker busy (${String(body.detail ?? "queue_full")}) — will retry next scan`);
  }
  if (!res.ok) {
    throw new Error(String(body.detail ?? body.error ?? `Worker HTTP ${res.status}`));
  }
  return body;
}

/** Route ingest to worker when configured; otherwise local qBittorrent CLI. */
export async function pipelineIngest(url: string, title = ""): Promise<Record<string, unknown>> {
  const cfg = getPipelineClientConfig();

  // #region agent log
  fetch("http://127.0.0.1:7764/ingest/e854a7d6-8db2-49e5-8f2f-515159bdc83b", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d4ef46" },
    body: JSON.stringify({
      sessionId: "d4ef46",
      hypothesisId: "A",
      location: "pipelineClient.ts:pipelineIngest",
      message: "ingest route",
      data: { mode: cfg.mode, workerUrl: !!cfg.workerUrl, localDownloads: cfg.localDownloads, urlKind: url.slice(0, 12) },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (url.startsWith("tgfile://")) {
    if (cfg.workerUrl) return remoteIngest(url, title);
    return runPythonCli(["telegram-ingest", url, "--title", title]);
  }

  if (cfg.workerUrl && (cfg.mode === "remote" || !cfg.localDownloads)) {
    return remoteIngest(url, title);
  }

  return runPythonCli(["torrent-ingest", url]);
}

/** True when worker handles download/process/upload (not local orchestrator). */
export function isRemotePipeline(): boolean {
  const cfg = getPipelineClientConfig();
  return !!cfg.workerUrl && (cfg.mode === "remote" || !cfg.localDownloads);
}
