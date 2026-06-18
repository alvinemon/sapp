import { useCallback, useRef, useState } from "react";
import type { AgentAction, AgentResult } from "../utils/agent";
import { MAX_AGENT_ROUNDS, runDeepSeekAgent } from "../utils/agent";
import type { UiTree } from "../types/uiTree";
import { compactTreeForAgent } from "../utils/screenGuide";

export interface AgentLog {
  id: number;
  role: "user" | "agent" | "action" | "error";
  text: string;
}

export function useAgent(
  send: (payload: Record<string, unknown>) => void,
  getTree: () => UiTree | null,
  waitForTree: (sinceTick: number, maxMs?: number) => Promise<number>,
  getTreeTick: () => number,
) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const logId = useRef(0);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const waitForLiveTree = useCallback(async (maxMs = 8000): Promise<UiTree | null> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const t = getTree();
      if (t) return t;
      await new Promise((r) => setTimeout(r, 400));
    }
    return getTree();
  }, [getTree]);

  const addLog = useCallback((role: AgentLog["role"], text: string) => {
    setLogs((l) => [...l.slice(-40), { id: ++logId.current, role, text }]);
  }, []);

  const execAction = useCallback(
    async (action: AgentAction) => {
      switch (action.type) {
        case "tap":
          if (action.x != null && action.y != null) {
            send({ type: "tap", x: action.x, y: action.y });
            addLog("action", `tap (${Math.round(action.x)}, ${Math.round(action.y)})${action.why ? ` — ${action.why}` : ""}`);
          }
          break;
        case "text":
          if (action.text) {
            send({ type: "text", text: action.text });
            addLog("action", `type "${action.text}"`);
          }
          break;
        case "key":
          if (action.action) {
            send({ type: "key", action: action.action });
            addLog("action", `key ${action.action}`);
            if (action.action === "wake" || action.action === "power") {
              await new Promise((r) => setTimeout(r, 1200));
            }
          }
          break;
        case "swipe":
          if (action.x != null && action.y != null && action.x2 != null && action.y2 != null) {
            send({ type: "swipe", x: action.x, y: action.y, x2: action.x2, y2: action.y2, duration: 300 });
            addLog("action", "swipe");
          }
          break;
        case "wait":
          await new Promise((r) => setTimeout(r, action.ms ?? 700));
          break;
      }
      await new Promise((r) => setTimeout(r, 400));
    },
    [send, addLog],
  );

  const runPrompt = useCallback(
    async (goal: string, _tree: UiTree | null) => {
      let tree = getTree() ?? (await waitForLiveTree(6000));
      if (!tree) {
        addLog("error", "No screen data — wait for device to connect");
        return;
      }
      setRunning(true);
      addLog("user", goal);
      historyRef.current = [];

      try {
        let taskPrompt = goal;

        for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
          let currentTree = getTree();
          if (!currentTree) {
            addLog("agent", "Waiting for screen…");
            currentTree = await waitForLiveTree(8000);
          }
          if (!currentTree) {
            addLog("error", "Lost screen data — phone may be asleep. Try Wake, then retry.");
            break;
          }

          const screen = compactTreeForAgent(currentTree);
          let result: AgentResult;
          try {
            result = await runDeepSeekAgent(taskPrompt, screen, historyRef.current);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Agent failed";
            if (msg.includes("not configured") || msg.includes("503")) {
              addLog("error", "AI not configured on server — set DEEPSEEK_API_KEY on Render");
            } else {
              addLog("error", msg);
            }
            break;
          }
          addLog("agent", result.say);
          historyRef.current.push({ role: "user", content: `Task: ${taskPrompt}\nScreen: ${screen.slice(0, 500)}` });
          historyRef.current.push({ role: "assistant", content: result.say });
          if (historyRef.current.length > 12) historyRef.current = historyRef.current.slice(-12);

          for (const action of result.actions) {
            await execAction(action);
          }

          if (result.done) {
            addLog("agent", "✓ Task complete");
            break;
          }

          if (round < MAX_AGENT_ROUNDS - 1) {
            addLog("agent", `Continuing (step ${round + 2}/${MAX_AGENT_ROUNDS})…`);
            const tick = getTreeTick();
            await waitForTree(tick, 8000);
            await new Promise((r) => setTimeout(r, 800));
            taskPrompt = `Continue: ${goal}`;
          } else {
            addLog("agent", "Reached max steps — try again or refine the prompt");
          }
        }
      } catch (e) {
        addLog("error", e instanceof Error ? e.message : "Agent failed");
      } finally {
        setRunning(false);
      }
    },
    [getTree, getTreeTick, waitForTree, waitForLiveTree, addLog, execAction],
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
    historyRef.current = [];
  }, []);

  return { running, logs, runPrompt, clearLogs };
}
