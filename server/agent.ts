import { formatDeviceBlock } from "./deviceGuide.js";

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
  /** Reference a numbered target from the screen list (#N) instead of guessing coordinates. */
  target?: number;
}

export interface AgentResult {
  thought: string;
  say: string;
  actions: AgentAction[];
  done: boolean;
  reasoning?: string;
}

export interface DeviceContext {
  model?: string;
  manufacturer?: string;
  android?: number;
  screenW?: number;
  screenH?: number;
  locked?: boolean;
  ready?: boolean;
}

export function resolveDeepSeekApiKey(fromRequest?: string): string {
  return (fromRequest?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "").trim();
}

export function resolveAgentModel(): string {
  return process.env.DEEPSEEK_AGENT_MODEL?.trim() || "deepseek-reasoner";
}

export const MAX_ACTIONS_PER_TURN = 8;
export const MAX_AGENT_ROUNDS = 8;

function buildSystem(device?: DeviceContext): string {
  const deviceBlock = formatDeviceBlock(device);
  return `You operate a real Android phone remotely. You CAN see the screen as a structured list of numbered targets (#1, #2, …) with coordinates — use them.

Rules:
1. Read the screen list carefully before acting. Prefer "target": N (references #N) over raw x/y when a target exists.
2. System popups (Allow, OK, Continue, Don't allow) ALWAYS come first — tap the matching #N.
3. If LOCKED or keyguard: first actions must be key unlock or swipe up from bottom center.
4. One UI step at a time; wait for screen updates between major steps.
5. If the goal is impossible on this screen, say so in "say" and set done:true.
6. Match behavior to the phone brand/model hints below.

Actions (max ${MAX_ACTIONS_PER_TURN}/turn):
- tap: {"type":"tap","target":3} or {"type":"tap","x":540,"y":1200,"why":"..."}
- text: {"type":"text","text":"hello"}
- key: wake|unlock|back|home|recents
- swipe: x,y,x2,y2,duration(ms)
- wait: ms (max 200)

Respond with JSON ONLY (no markdown):
{"thought":"brief plan","say":"short user message","actions":[...],"done":false}

${deviceBlock ? `\nPhone profile:\n${deviceBlock}` : ""}`;
}

function parseAgentJson(raw: string): AgentResult {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as AgentResult;
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as AgentResult;
    throw new Error("Agent returned invalid JSON");
  }
}

function resolveTargets(actions: AgentAction[], screen: string): AgentAction[] {
  const targetRe = /#(\d+)\s[^\n]*@\s*\((\d+),(\d+)\)/g;
  const coords = new Map<number, { x: number; y: number }>();
  let m: RegExpExecArray | null;
  while ((m = targetRe.exec(screen)) !== null) {
    coords.set(Number(m[1]), { x: Number(m[2]), y: Number(m[3]) });
  }
  // Also match compact format: #3 Label (540,1200)
  const compactRe = /#(\d+)\s[^\n(]*\((\d+),(\d+)\)/g;
  while ((m = compactRe.exec(screen)) !== null) {
    if (!coords.has(Number(m[1]))) {
      coords.set(Number(m[1]), { x: Number(m[2]), y: Number(m[3]) });
    }
  }

  return actions.map((a) => {
    if (a.type !== "tap" || a.target == null) return a;
    const c = coords.get(a.target);
    if (!c) return a;
    return { ...a, x: c.x, y: c.y, why: a.why ?? `#${a.target}` };
  });
}

export async function runAgent(
  prompt: string,
  screen: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  apiKey: string,
  device?: DeviceContext,
): Promise<AgentResult> {
  if (!apiKey) throw new Error("DeepSeek API key not configured");

  const model = resolveAgentModel();
  const isReasoner = model.includes("reasoner");

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: buildSystem(device) },
      ...history,
      {
        role: "user",
        content: `Screen:\n${screen}\n\nTask: ${prompt}`,
      },
    ],
    stream: false,
    max_tokens: isReasoner ? 4096 : 768,
  };

  if (!isReasoner) {
    body.response_format = { type: "json_object" };
    body.temperature = 0;
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err.slice(0, 300) || `DeepSeek error ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string; reasoning_content?: string } }[];
  };
  const msg = data.choices?.[0]?.message;
  const raw = msg?.content?.trim() || "{}";
  const reasoning = msg?.reasoning_content?.trim() || "";

  const parsed = parseAgentJson(raw);
  parsed.actions = Array.isArray(parsed.actions)
    ? resolveTargets(parsed.actions.slice(0, MAX_ACTIONS_PER_TURN), screen)
    : [];
  parsed.say = parsed.say || "Working…";
  parsed.thought = parsed.thought || reasoning.slice(0, 400);
  parsed.reasoning = reasoning || undefined;
  parsed.done = !!parsed.done;
  return parsed;
}
