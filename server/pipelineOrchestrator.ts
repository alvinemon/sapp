import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { dataPath } from "./dataPath.js";
import { getPipelineClientConfig, isRemotePipeline, checkWorkerHealth, workerConfigured } from "./pipelineClient.js";

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");

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

function ensureDataDirs(): void {
  for (const part of ["", "incoming", "ready", "logs"]) {
    const dir = part ? dataPath("pipeline", part) : dataPath("pipeline");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const catalog = dataPath("catalog.json");
  if (!existsSync(catalog)) {
    writeFileSync(catalog, JSON.stringify({ items: [] }, null, 2) + "\n", "utf8");
  }
  const state = dataPath("pipeline", "state.json");
  if (!existsSync(state)) {
    writeFileSync(state, "{}\n", "utf8");
  }
  const uploadLog = dataPath("pipeline", "upload_log.json");
  if (!existsSync(uploadLog)) {
    writeFileSync(uploadLog, JSON.stringify({ uploads: [] }, null, 2) + "\n", "utf8");
  }
}

let orchestratorTimer: ReturnType<typeof setInterval> | null = null;
let cycleInFlight = false;

async function runPostDownloadCycle(): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  try {
    for (const step of ["process", "upload", "publish"] as const) {
      try {
        const result = await runPythonCli([step]);
        const moved = result.moved ?? 0;
        const uploaded = result.uploaded ?? 0;
        if (moved || uploaded || result.published) {
          console.error(`[pipeline] ${step}: ${JSON.stringify(result)}`);
        }
      } catch (e) {
        console.error(`[pipeline] ${step} failed:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    cycleInFlight = false;
  }
}

export async function bootstrapPipeline(): Promise<void> {
  ensureDataDirs();
  const cfg = getPipelineClientConfig();
  if (workerConfigured()) {
    const health = await checkWorkerHealth();
    // #region agent log
    fetch("http://127.0.0.1:7764/ingest/e854a7d6-8db2-49e5-8f2f-515159bdc83b", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d4ef46" },
      body: JSON.stringify({
        sessionId: "d4ef46",
        hypothesisId: "B",
        location: "pipelineOrchestrator.ts:bootstrapPipeline",
        message: "worker health at boot",
        data: { workerUrl: cfg.workerUrl, healthOk: health.ok, detail: health.detail },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    console.error(
      `[pipeline] Worker ${health.ok ? "online" : "offline"} at ${cfg.workerUrl}${health.detail ? ` (${health.detail})` : ""}`,
    );
    if (health.ok) return;
  }
  if (isRemotePipeline()) {
    console.error(
      `[pipeline] Remote mode — worker unreachable (worker: ${cfg.workerUrl || "PIPELINE_WORKER_URL not set"})`,
    );
    return;
  }
  try {
    const setup = await runPythonCli(["setup"]);
    console.error("[pipeline] setup:", JSON.stringify(setup));
  } catch (e) {
    console.error(
      "[pipeline] setup skipped (qBittorrent may be offline):",
      e instanceof Error ? e.message : e,
    );
  }
}

export function startPipelineOrchestrator(intervalMinutes = 5): void {
  if (orchestratorTimer) return;
  if (isRemotePipeline()) {
    console.error("[pipeline] Orchestrator skipped — remote worker handles process/upload/publish");
    return;
  }
  const ms = intervalMinutes * 60_000;
  console.error(`[pipeline] Orchestrator starting — process/upload/publish every ${intervalMinutes} min`);
  void runPostDownloadCycle();
  orchestratorTimer = setInterval(() => {
    void runPostDownloadCycle();
  }, ms);
}

export function stopPipelineOrchestrator(): void {
  if (orchestratorTimer) {
    clearInterval(orchestratorTimer);
    orchestratorTimer = null;
  }
}
