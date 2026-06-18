export interface AgentAction {
  type: "tap" | "text" | "key" | "swipe" | "wait";
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  text?: string;
  action?: string;
  ms?: number;
  why?: string;
}

export interface AgentResult {
  thought: string;
  say: string;
  actions: AgentAction[];
  done: boolean;
}

export const MAX_AGENT_ROUNDS = 6;

export async function runDeepSeekAgent(
  prompt: string,
  screen: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
) {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, screen, history }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Agent failed (${res.status})`);
  }
  return res.json() as Promise<AgentResult>;
}
