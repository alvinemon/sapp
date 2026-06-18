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

export const MAX_ACTIONS_PER_TURN = 12;
export const MAX_AGENT_ROUNDS = 6;

const SYSTEM = `You control an Android phone like a person using it — tap, type, swipe, open apps, wake from sleep.

Respond with JSON only:
{
  "thought": "brief reasoning",
  "say": "one sentence for the user",
  "actions": [
    {"type":"key","action":"wake"},
    {"type":"wait","ms":1200},
    {"type":"tap","x":540,"y":1200,"why":"open Chrome"},
    {"type":"text","text":"hello"},
    {"type":"key","action":"back"},
    {"type":"swipe","x":540,"y":1800,"x2":540,"y2":600}
  ],
  "done": false
}

Capabilities — use like a human:
- Wake from sleep FIRST when screen is black/off: {"type":"key","action":"wake"} then wait 1000–1500ms
- Tap, swipe, type, back, home, recents
- Open apps via launcher, Play Store, or search
- Multi-step tasks across turns until done:true

Sleep / lock:
- Screen black or empty → wake, wait, then act
- Phone auto-wakes on tap too, but always wake+wait when unsure

Strategy:
1. Break goals across turns — done:false until finished
2. After wake or app launch, wait 800–1200ms before next action
3. Handle popups first (Allow, OK)
4. Set done:true only when the user's goal is fully achieved

Rules:
- Prefer numbered tap targets (#N at x,y)
- Max ${MAX_ACTIONS_PER_TURN} actions per turn`;

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
        { role: "user", content: `Current screen:\n${screen}\n\nUser task: ${prompt}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
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
