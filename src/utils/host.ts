/** Production relay hosts — Render only (no local/Mac pipeline). */
export const RELAY_HOSTS = ["2hotatl-relay.onrender.com", "sapp-xoyi.onrender.com"] as const;

const STORAGE_KEY = "2hotatl_relay_host";

/** Page hostname normalized to relay host (localhost stays local). */
export function siteHost(): string {
  if (typeof window === "undefined") return RELAY_HOSTS[0];
  const { hostname, host, port } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return port ? `${hostname}:${port}` : hostname;
  if (hostname.endsWith(".onrender.com")) return hostname;
  return RELAY_HOSTS[0];
}

/** Ordered host candidates: page host (prod), built-in list, saved, then local dev page. */
export function relayHosts(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (h: string | undefined | null) => {
    if (!h || seen.has(h)) return;
    seen.add(h);
    out.push(h);
  };
  if (typeof window !== "undefined") {
    const page = siteHost();
    if (page && !page.startsWith("localhost") && !page.startsWith("127.0.0.1")) add(page);
  }
  for (const h of RELAY_HOSTS) add(h);
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) add(saved);
    } catch {
      /* ignore */
    }
    const page = siteHost();
    if (page?.startsWith("localhost") || page?.startsWith("127.0.0.1")) add(page);
  }
  return out;
}

export async function checkHealth(host: string, timeoutMs = 8000): Promise<boolean> {
  try {
    const proto = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http:" : "https:";
    const res = await fetch(`${proto}//${host}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return false;
    const data = await res.json();
    return data?.ok === true;
  } catch {
    return false;
  }
}

/** Pick first healthy host; falls back to first candidate if none respond. */
export async function pickRelayHost(): Promise<string> {
  const hosts = relayHosts();
  for (const h of hosts) {
    if (await checkHealth(h)) {
      try {
        localStorage.setItem(STORAGE_KEY, h);
      } catch {
        /* ignore */
      }
      return h;
    }
  }
  return hosts[0] ?? RELAY_HOSTS[0];
}

export function saveRelayHost(host: string) {
  try {
    localStorage.setItem(STORAGE_KEY, host);
  } catch {
    /* ignore */
  }
}

export function apiBase(host: string): string {
  const proto = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http:" : "https:";
  return `${proto}//${host}`;
}

export function wsBase(host: string): string {
  const proto = host.includes("localhost") || host.startsWith("127.0.0.1") ? "ws:" : "wss:";
  return `${proto}//${host}`;
}
