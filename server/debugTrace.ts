import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_ENTRIES = 100;

export interface TraceEntry {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

const entries: TraceEntry[] = [];

function debugLogPath(): string | null {
  if (process.env.DEBUG_TRACE_PATH) return process.env.DEBUG_TRACE_PATH;
  if (process.env.DEBUG_SESSION === "d4ef46") return "/Users/alvin/Desktop/.cursor/debug-d4ef46.log";
  return null;
}

function appendNdjson(path: string, obj: object) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(obj)}\n`, "utf8");
  } catch {
    /* ignore disk errors */
  }
}

export function trace(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
) {
  const entry: TraceEntry = {
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  const path = debugLogPath();
  if (path) appendNdjson(path, { sessionId: "d4ef46", ...entry });
}

export function getTraceEntries(): TraceEntry[] {
  return [...entries];
}
