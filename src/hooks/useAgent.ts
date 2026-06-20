import { useCallback, useRef, useState } from "react";
import type { DeviceState } from "../types/device";
import type { AgentAction, AgentResult } from "../utils/agent";
import { MAX_AGENT_ROUNDS, runDeepSeekAgent } from "../utils/agent";
import type { AgentDeviceContext } from "../utils/deviceGuide";
import type { UiTree } from "../types/uiTree";
import { compactTreeForAgent } from "../utils/screenGuide";

const POLL_MS = 40;
const ACTION_GAP_MS = 40;
const BATCH_TAP_GAP_MS = 30;
const WAKE_SETTLE_MS = 350;
const UNLOCK_SETTLE_MS = 800;
const ROUND_GAP_MS = 50;
const MAX_WAIT_MS = 200;
const SWIPE_MS = 180;

export interface AgentLog {
  id: number;
  role: "user" | "agent" | "action" | "error";
  kind: "user" | "plan" | "system" | "action" | "error";
  text: string;
}

function logKind(role: AgentLog["role"], text: string): AgentLog["kind"] {
  if (role === "error") return "error";
  if (role === "action") return "action";
  if (role === "user") return "user";
  if (text.startsWith("💭")) return "plan";
  return "system";
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
  getDeviceState: () => DeviceState | null,
  waitForReady: (maxMs?: number) => Promise<boolean>,
  getDeviceContext: () => AgentDeviceContext,
) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [runStep, setRunStep] = useState(0);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [lastGoal, setLastGoal] = useState("");
  const logId = useRef(0);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const stepRef = useRef(0);

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
    const kind = logKind(role, text);
    setLogs((l) => [...l.slice(-40), { id: ++logId.current, role, kind, text }]);
  }, []);

  const ensureReady = useCallback(async () => {
    const state = getDeviceState();
    if (state?.ready && getTree()) return;

    if (!ScreenPowerNeedsWake(state)) {
      if (getTree()) return;
    }

    addLog("agent", "Waking phone…");
    send({ type: "key", action: "wake" });
    await new Promise((r) => setTimeout(r, WAKE_SETTLE_MS));

    const locked = getDeviceState()?.locked ?? state?.locked;
    if (locked || !getTree()) {
      addLog("agent", "Unlocking…");
      send({ type: "key", action: "unlock" });
      await new Promise((r) => setTimeout(r, UNLOCK_SETTLE_MS));
      await waitForReady(5000);
    }

    await waitForLiveTree(3000);
  }, [send, getTree, getDeviceState, waitForReady, waitForLiveTree, addLog]);

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
            if (action.action === "wake" || action.action === "unlock") {
              await new Promise((r) => setTimeout(r, action.action === "unlock" ? UNLOCK_SETTLE_MS : WAKE_SETTLE_MS));
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
    [send, addLog],
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
      setLastGoal(goal);
      setRunStartedAt(Date.now());
      stepRef.current = 0;
      setRunStep(0);
      addLog("user", goal);
      historyRef.current = [];

      try {
        await ensureReady();
        let tree = await waitForLiveTree(5000);
        if (!tree) {
          addLog("error", "No screen — tap Unlock or enable Watch Together on the phone");
          return;
        }

        let taskPrompt = goal;
        let nextAgentPromise: Promise<AgentResult> | null = null;

        for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
          stepRef.current = round + 1;
          setRunStep(round + 1);
          const state = getDeviceState();
          if (state?.locked || !getTree()) {
            addLog("agent", "Phone locked — unlocking…");
            await ensureReady();
          }

          let currentTree = getTree();
          if (!currentTree) {
            await ensureReady();
            currentTree = await waitForLiveTree(3000);
          }
          if (!currentTree) {
            addLog("error", "Could not read screen — tap Unlock on the portal");
            break;
          }

          const screen = compactTreeForAgent(currentTree);
          const deviceCtx = getDeviceContext();
          const deviceBlock = deviceCtx.manufacturer || deviceCtx.model ? `\n\nDevice:\n${deviceCtx.manufacturer ?? ""} ${deviceCtx.model ?? ""}`.trim() : "";
          const lockedHint = state?.locked ? "\n\n(Phone is LOCKED — use key unlock or swipe first.)" : "";
          const screenHint = screen.includes("black") || screen.length < 40
            ? `${screen}${deviceBlock}${lockedHint}\n\n(Screen appears off — wake and unlock first.)`
            : screen + deviceBlock + lockedHint;

          let result: AgentResult;
          try {
            result = nextAgentPromise ?? await runDeepSeekAgent(taskPrompt, screenHint, historyRef.current, deviceCtx);
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
          if (result.thought) addLog("agent", `💭 ${result.thought.slice(0, 280)}`);
          addLog("agent", result.say);
          historyRef.current.push({ role: "user", content: `Task: ${taskPrompt}\nScreen: ${screen.slice(0, 300)}` });
          historyRef.current.push({ role: "assistant", content: result.say });
          if (historyRef.current.length > 8) historyRef.current = historyRef.current.slice(-8);

          const tick = getTreeTick();
          const actionsPromise = execActions(result.actions);

          if (result.done) {
            await actionsPromise;
            addLog("agent", "Task complete");
            break;
          }

          if (round < MAX_AGENT_ROUNDS - 1) {
            await Promise.all([actionsPromise, waitForTree(tick, 1000)]);
            await new Promise((r) => setTimeout(r, ROUND_GAP_MS));
            taskPrompt = `Continue: ${goal}`;
            const nextTree = getTree();
            if (nextTree) {
              nextAgentPromise = runDeepSeekAgent(
                taskPrompt,
                compactTreeForAgent(nextTree),
                historyRef.current,
                getDeviceContext(),
              );
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
        setRunStep(0);
        setRunStartedAt(null);
      }
    },
    [getTree, getTreeTick, waitForTree, waitForLiveTree, ensureReady, getDeviceState, getDeviceContext, addLog, execActions],
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
    historyRef.current = [];
  }, []);

  const elapsedMs = runStartedAt ? Date.now() - runStartedAt : 0;

  return { running, logs, runPrompt, clearLogs, ensureReady, runStep, runStartedAt, lastGoal, maxSteps: MAX_AGENT_ROUNDS };
}

function ScreenPowerNeedsWake(state: DeviceState | null): boolean {
  if (!state) return true;
  return !state.awake;
}
