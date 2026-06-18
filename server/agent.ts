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

const SYSTEM = `You control an Android phone remotely. You receive a text description of the current screen with numbered tap targets (#N at x,y).

Respond with JSON only:
{
  "thought": "brief reasoning",
  "say": "one sentence for the user",
  "actions": [
    {"type":"tap","x":540,"y":1200,"why":"open Play Store"},
    {"type":"text","text":"Limbo"},
    {"type":"key","action":"back"},
    {"type":"swipe","x":540,"y":1800,"x2":540,"y2":600,"why":"scroll down"},
    {"type":"wait","ms":1000}
  ],
  "done": false
}

Capabilities:
- Open apps via launcher, Play Store, or in-app search
- Play Store flow: open Play Store → tap search → type app/game name → tap result → Install → Open
- Scroll/swipe to reveal off-screen items
- Use back/home/recents to navigate between apps
- Type into search bars and text fields

Strategy for multi-step goals (e.g. "play Limbo", "install Instagram"):
1. Break work across turns — set done:false until the goal is truly finished
2. To install & play a game: Play Store → search name → Install → wait → Open
3. If already installed: home → app drawer or search → tap icon
4. After opening apps or tapping Install, use wait 800-1200ms before next tap
5. Handle permission/popup dialogs first (Allow, OK, Continue)

Rules:
- Prefer tapping numbered targets using their coordinates
- For popups, handle popup actions first
- Use swipe to scroll lists and app drawers
- Set done:true ONLY when the user's goal is fully achieved (e.g. game is open)
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
