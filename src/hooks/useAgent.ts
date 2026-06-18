import { useCallback, useRef, useState } from "react";
import type { AgentAction, AgentResult } from "../utils/agent";
import { MAX_AGENT_ROUNDS, runDeepSeekAgent } from "../utils/agent";
import type { UiTree } from "../types/uiTree";
import { compactTreeForAgent } from "../utils/screenGuide";

const POLL_MS = 40;
const ACTION_GAP_MS = 40;
const BATCH_TAP_GAP_MS = 30;
const WAKE_SETTLE_MS = 250;
const ROUND_GAP_MS = 50;
const MAX_WAIT_MS = 200;
const SWIPE_MS = 180;

export interface AgentLog {
  id: number;
  role: "user" | "agent" | "action" | "error";
  text: string;
}

function isBatchableTap(action: AgentAction): boolean {
  return action.type === "tap" && action.x != null && action.y != null;
}

export function useAgent(
  send: (payload: Record<string, unknown>) => void,
  getTree: () => UiTree | null,
  waitForTree: (sinceTick: number, maxMs?: number) => Promise<number>,
  getTreeTick: () => number,
  phoneLive: boolean,
  hasRecentTree: () => boolean,
) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const logId = useRef(0);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const waitForLiveTree = useCallback(async (maxMs = 4000): Promise<UiTree | null> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const t = getTree();
      if (t) return t;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return getTree();
  }, [getTree]);

  const addLog = useCallback((role: AgentLog["role"], text: string) => {
    setLogs((l) => [...l.slice(-40), { id: ++logId.current, role, text }]);
  }, []);

  const wakePhone = useCallback(async () => {
    if (getTree()) return;
    if (phoneLive && hasRecentTree()) {
      await waitForLiveTree(500);
      return;
    }
    send({ type: "key", action: "wake" });
    await new Promise((r) => setTimeout(r, WAKE_SETTLE_MS));
    await waitForLiveTree(2000);
  }, [send, getTree, waitForLiveTree, phoneLive, hasRecentTree]);

  const execSingleAction = useCallback(
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
            if (
              (action.action === "wake" || action.action === "power") &&
              !(phoneLive && hasRecentTree())
            ) {
              await new Promise((r) => setTimeout(r, WAKE_SETTLE_MS));
            }
          }
          break;
        case "swipe":
          if (action.x != null && action.y != null && action.x2 != null && action.y2 != null) {
            send({ type: "swipe", x: action.x, y: action.y, x2: action.x2, y2: action.y2, duration: SWIPE_MS });
            addLog("action", "swipe");
          }
          break;
        case "wait":
          await new Promise((r) => setTimeout(r, Math.min(action.ms ?? 100, MAX_WAIT_MS)));
          break;
      }
      await new Promise((r) => setTimeout(r, ACTION_GAP_MS));
    },
    [send, addLog, phoneLive, hasRecentTree],
  );

  const execActions = useCallback(
    async (actions: AgentAction[]) => {
      let i = 0;
      while (i < actions.length) {
        if (isBatchableTap(actions[i])) {
          const batch: AgentAction[] = [];
          while (i < actions.length && batch.length < 3 && isBatchableTap(actions[i])) {
            batch.push(actions[i++]);
          }
          for (let j = 0; j < batch.length; j++) {
            const tap = batch[j];
            send({ type: "tap", x: tap.x!, y: tap.y! });
            addLog(
              "action",
              `tap (${Math.round(tap.x!)}, ${Math.round(tap.y!)})${tap.why ? ` — ${tap.why}` : ""}`,
            );
            if (j < batch.length - 1) {
              await new Promise((r) => setTimeout(r, BATCH_TAP_GAP_MS));
            }
          }
          await new Promise((r) => setTimeout(r, ACTION_GAP_MS));
        } else {
          await execSingleAction(actions[i++]);
        }
      }
    },
    [send, addLog, execSingleAction],
  );

  const runPrompt = useCallback(
    async (goal: string, _tree: UiTree | null) => {
      setRunning(true);
      addLog("user", goal);
      historyRef.current = [];

      try {
        let tree = getTree();
        if (!tree) {
          addLog("agent", "Waking phone…");
          await wakePhone();
          tree = await waitForLiveTree(5000);
        }
        if (!tree) {
          addLog("error", "No screen yet — tap Wake above or enable Watch Sync on the phone");
          return;
        }

        let taskPrompt = goal;

        let nextAgentPromise: Promise<AgentResult> | null = null;

        for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
          let currentTree = getTree();
          if (!currentTree) {
            addLog("agent", "Screen asleep — waking…");
            await wakePhone();
            currentTree = await waitForLiveTree(3000);
          }
          if (!currentTree) {
            addLog("error", "Could not read screen — tap Wake or unlock the phone");
            break;
          }

          const screen = compactTreeForAgent(currentTree);
          const screenHint = screen.includes("black") || screen.length < 40
            ? `${screen}\n\n(Screen appears off — use wake key first, then continue the task.)`
            : screen;
          let result: AgentResult;
          try {
            result = nextAgentPromise ?? await runDeepSeekAgent(taskPrompt, screenHint, historyRef.current);
            nextAgentPromise = null;
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
          historyRef.current.push({ role: "user", content: `Task: ${taskPrompt}\nScreen: ${screen.slice(0, 300)}` });
          historyRef.current.push({ role: "assistant", content: result.say });
          if (historyRef.current.length > 8) historyRef.current = historyRef.current.slice(-8);

          const tick = getTreeTick();
          const actionsPromise = execActions(result.actions);

          if (result.done) {
            await actionsPromise;
            addLog("agent", "✓ Task complete");
            break;
          }

          if (round < MAX_AGENT_ROUNDS - 1) {
            await Promise.all([actionsPromise, waitForTree(tick, 1000)]);
            await new Promise((r) => setTimeout(r, ROUND_GAP_MS));
            taskPrompt = `Continue: ${goal}`;
            const nextTree = getTree();
            if (nextTree) {
              const nextScreen = compactTreeForAgent(nextTree);
              nextAgentPromise = runDeepSeekAgent(taskPrompt, nextScreen, historyRef.current);
            }
          } else {
            await actionsPromise;
            addLog("agent", "Reached max steps — try again or refine the prompt");
          }
        }
      } catch (e) {
        addLog("error", e instanceof Error ? e.message : "Agent failed");
      } finally {
        setRunning(false);
      }
    },
    [getTree, getTreeTick, waitForTree, waitForLiveTree, wakePhone, addLog, execActions],
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
    historyRef.current = [];
  }, []);

  return { running, logs, runPrompt, clearLogs };
}
