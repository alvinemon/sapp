/** Dynamic pricing — local Python or remote pipeline worker. */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPipelineClientConfig, isRemotePipeline } from "./pipelineClient.js";

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");

function pythonBin(): string {
  const venv = join(PIPELINE_DIR, ".venv", "bin", "python3");
  if (existsSync(venv)) return venv;
  return process.env.PYTHON_BIN?.trim() || "python3";
}

function runCli(args: string[], stdin?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin(), ["cli.py", ...args], {
      cwd: PIPELINE_DIR,
      env: { ...process.env, PYTHONPATH: PIPELINE_DIR },
    });
    let stdout = "";
    let stderr = "";
    if (stdin) proc.stdin.write(stdin);
    proc.stdin.end();
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `cli exit ${code}`));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) as Record<string, unknown> : { ok: true });
      } catch {
        resolve({ ok: true, output: stdout.trim() });
      }
    });
  });
}

async function remotePricing(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cfg = getPipelineClientConfig();
  if (!cfg.workerUrl) throw new Error("PIPELINE_WORKER_URL not set");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.workerSecret) headers.Authorization = `Bearer ${cfg.workerSecret}`;
  const res = await fetch(`${cfg.workerUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.detail ?? data.error ?? `worker ${res.status}`));
  return data;
}

export async function fetchPricingQuote(userId: string, contentId: string): Promise<Record<string, unknown>> {
  if (isRemotePipeline() && getPipelineClientConfig().workerUrl) {
    return remotePricing("/pricing/quote", { user_id: userId, content_id: contentId });
  }
  return runCli(["quote", userId, contentId]);
}

export async function postPricingAttempt(body: Record<string, unknown>): Promise<void> {
  const payload = {
    user_id: body.user_id ?? body.userId,
    content_id: body.content_id ?? body.contentId,
    price_shown: body.price_shown ?? body.priceShown,
    purchased: body.purchased,
    features: body.features,
  };
  if (isRemotePipeline() && getPipelineClientConfig().workerUrl) {
    await remotePricing("/pricing/attempt", payload);
    return;
  }
  await runCli(["attempt"], JSON.stringify(payload));
}

export async function postUserMetrics(userId: string, metrics: Record<string, unknown>): Promise<void> {
  if (isRemotePipeline() && getPipelineClientConfig().workerUrl) {
    await remotePricing("/pricing/metrics", { user_id: userId, metrics });
    return;
  }
  await runCli(["metrics", userId], JSON.stringify(metrics));
}

export async function trainPricingRemote(): Promise<Record<string, unknown>> {
  if (isRemotePipeline() && getPipelineClientConfig().workerUrl) {
    return remotePricing("/pricing/train", {});
  }
  return runCli(["train"]);
}
