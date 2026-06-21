import { getAdminKey } from "./catalog";

export interface PipelineStatus {
  lastPipeline: Record<string, unknown> | null;
  lastIngest: string | null;
  lastProcess: string | null;
  lastPublish: string | null;
  catalogCount: number;
  uploadCount: number;
  publicUrl: string | null;
  pipelineMode?: "local" | "remote";
  pipelineWorkerUrl?: string | null;
  localDownloads?: boolean;
  remotePipeline?: boolean;
  paths: { incoming: string; ready: string };
}

export interface FeedHealth {
  name: string;
  url: string;
  status: "green" | "yellow" | "red";
  scheme: string;
  lastError: string | null;
  lastItemCount: number;
}

export interface RssScannerStatus {
  enabled: boolean;
  feedCount: number;
  keywordCount: number;
  blacklistCount: number;
  intervalMinutes: number;
  lastScanAt: string | null;
  lastScanNewMatches: number;
  lastScanErrors: string[];
  scanning: boolean;
  totalSeen: number;
  pendingJobs?: number;
  feeds?: FeedHealth[];
}

export interface PipelineCatalogItem {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  quality?: string;
  languages?: string[];
  telegram_file_id?: string;
  uploaded_at?: string;
  early_access?: boolean;
  early_access_until?: string;
}

export interface PipelineRevenue {
  total_purchases: number;
  total_attempts: number;
  average_price: number;
  conversion_rate: number;
  distribution: { price: number; count: number }[];
}

const adminKey = () => getAdminKey();

function q(editKey: string) {
  return editKey ? `?editKey=${encodeURIComponent(editKey)}` : "";
}

export async function fetchPipelineStatus(): Promise<PipelineStatus> {
  const res = await fetch(`/api/pipeline/status${q(adminKey())}`);
  if (!res.ok) throw new Error("Failed to load pipeline status");
  return res.json();
}

export async function fetchRssScannerStatus(): Promise<RssScannerStatus> {
  const res = await fetch(`/api/pipeline/rss-status${q(adminKey())}`);
  if (!res.ok) throw new Error("Failed to load RSS scanner status");
  return res.json();
}

export async function fetchPipelineCatalog(): Promise<{ items: PipelineCatalogItem[]; generated_at?: string }> {
  const res = await fetch(`/api/pipeline/catalog${q(adminKey())}`);
  if (!res.ok) throw new Error("Failed to load pipeline catalog");
  return res.json();
}

export async function fetchPipelineLogs(): Promise<{ logs: { name: string; lines: string[] }[] }> {
  const res = await fetch(`/api/pipeline/logs${q(adminKey())}`);
  if (!res.ok) throw new Error("Failed to load logs");
  return res.json();
}

export async function fetchPipelineRevenue(): Promise<PipelineRevenue> {
  const res = await fetch(`/api/pipeline/revenue${q(adminKey())}`);
  if (!res.ok) throw new Error("Failed to load revenue");
  return res.json();
}

export interface PersistedFeedHealth {
  url: string;
  name: string;
  state: "green" | "yellow" | "red";
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  source: "config" | "fallback";
}

export async function fetchFeedHealth(): Promise<{ feeds: PersistedFeedHealth[] }> {
  const res = await fetch("/api/pipeline/feed-health");
  if (!res.ok) throw new Error("Failed to load feed health");
  return res.json();
}

export async function runPipeline(step: "all" | "ingest" | "process" | "upload" | "publish" = "all") {
  const res = await fetch("/api/pipeline/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey: adminKey(), step: step === "all" ? undefined : step }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Pipeline run failed");
  }
  return res.json();
}

export async function setEarlyAccess(itemId: string, enabled: boolean) {
  const res = await fetch("/api/pipeline/early-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey: adminKey(), itemId, enabled }),
  });
  if (!res.ok) throw new Error("Failed to update early access");
  return res.json();
}

export async function trainPricingModel() {
  const res = await fetch("/api/pipeline/train-pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey: adminKey() }),
  });
  if (!res.ok) throw new Error("Train failed");
  return res.json();
}
