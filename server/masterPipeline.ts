/** Unified 30-minute master pipeline cycle on relay. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { fetchFallbackFeeds, getFeedHealthRecords, healDownFeeds } from "./feedHealth.js";
import { getRssScannerStatus, relayRssEnabled, runRssScanOnce } from "./rssScanner.js";
import { isRemotePipeline } from "./pipelineClient.js";
import { parsePythonCliStdout } from "./pipeline.js";
import { spawn } from "node:child_process";

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");

let masterTimer: ReturnType<typeof setInterval> | null = null;
let cycleInFlight = false;

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
      resolve(parsePythonCliStdout(stdout));
    });
  });
}

function pipelineIntervalMinutes(): number {
  const configPath = join(PIPELINE_DIR, "config.yaml");
  const examplePath = join(PIPELINE_DIR, "config.example.yaml");
  const path = existsSync(configPath) ? configPath : examplePath;
  if (!existsSync(path)) return 30;
  try {
    const raw = parseYaml(readFileSync(path, "utf8")) as Record<string, unknown>;
    const rss = (raw.rss ?? {}) as Record<string, unknown>;
    return Number(rss.scan_interval_minutes ?? rss.orchestrator_interval_minutes ?? 30) || 30;
  } catch {
    return 30;
  }
}

async function runMasterCycle(): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  const ts = new Date().toISOString();
  console.error(`[master-pipeline] Cycle start ${ts} remote=${isRemotePipeline()}`);

  try {
    await fetchFallbackFeeds();
    const configPath = join(
      PIPELINE_DIR,
      existsSync(join(PIPELINE_DIR, "config.yaml")) ? "config.yaml" : "config.example.yaml",
    );
    const raw = parseYaml(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const feedsRaw = ((raw.rss as Record<string, unknown>)?.feeds ?? []) as Array<
      { url: string; name: string; status?: string } | string
    >;
    const configured = feedsRaw.map((f) =>
      typeof f === "string"
        ? { url: f, name: f, status: "green" }
        : { url: String(f.url), name: String(f.name ?? f.url), status: String(f.status ?? "green") },
    );
    const healed = await healDownFeeds(configured);
    console.error(
      `[master-pipeline] Feed health: ${healed.filter((f) => f.status === "green").length} green, ${healed.filter((f) => f.status !== "green").length} degraded`,
    );
  } catch (e) {
    console.error("[master-pipeline] Feed heal error:", e instanceof Error ? e.message : e);
  }

  if (relayRssEnabled()) {
    try {
      await runRssScanOnce();
    } catch (e) {
      console.error("[master-pipeline] RSS scan error:", e instanceof Error ? e.message : e);
    }
  }

  if (!isRemotePipeline()) {
    for (const step of ["ingest", "process", "upload", "publish"] as const) {
      try {
        const result = await runPythonCli([step]);
        console.error(`[master-pipeline] ${step}: ${JSON.stringify(result)}`);
      } catch (e) {
        console.error(`[master-pipeline] ${step} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }

  const rss = getRssScannerStatus();
  const health = getFeedHealthRecords();
  console.error(
    `[master-pipeline] RSS enabled=${rss.enabled} pending=${rss.pendingJobs ?? 0} seen=${rss.totalSeen} healthRecords=${health.length}`,
  );
  cycleInFlight = false;
}

export function startMasterPipeline(): void {
  if (masterTimer) return;
  const minutes = pipelineIntervalMinutes();
  console.error(`[master-pipeline] Scheduler every ${minutes} min`);
  void runMasterCycle();
  masterTimer = setInterval(() => { void runMasterCycle(); }, minutes * 60_000);
}

export function stopMasterPipeline(): void {
  if (masterTimer) {
    clearInterval(masterTimer);
    masterTimer = null;
  }
}
