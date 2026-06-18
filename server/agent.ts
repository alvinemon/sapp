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

export function resolveDeepSeekApiKey(fromRequest?: string): string {
  const key = (fromRequest?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "").trim();
  return key;
}

export const MAX_ACTIONS_PER_TURN = 8;
export const MAX_AGENT_ROUNDS = 6;

const SYSTEM = `Android phone control. JSON only:
{"thought":"","say":"brief","actions":[{"type":"tap","x":540,"y":1200}],"done":false}
Actions: tap, text, key (wake|unlock|back|home|recents), swipe, wait (max 200ms).
If screen shows lock/keyguard/PIN, first action must be key unlock or swipe up.
Use #N (x,y) targets. Popups first (Allow/OK). Max ${MAX_ACTIONS_PER_TURN} actions/turn. done:true when goal met.`;

export async function runAgent(
  prompt: string,
  screen: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  apiKey: string,
): Promise<AgentResult> {
  if (!apiKey) throw new Error("DeepSeek API key not configured");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM },
        ...history,
        { role: "user", content: `Screen:\n${screen}\n\nTask: ${prompt}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 384,
      stream: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err.slice(0, 200) || `DeepSeek error ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as AgentResult;
  parsed.actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, MAX_ACTIONS_PER_TURN) : [];
  parsed.say = parsed.say || "Working…";
  parsed.thought = parsed.thought || "";
  parsed.done = !!parsed.done;
  return parsed;
}
