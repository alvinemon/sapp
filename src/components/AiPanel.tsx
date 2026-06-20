import { useEffect, useMemo, useState } from "react";
import type { UiTree } from "../types/uiTree";
import type { useAgent } from "../hooks/useAgent";

type Agent = ReturnType<typeof useAgent>;

const KIND_LABEL: Record<string, string> = {
  user: "You",
  plan: "Plan",
  system: "AI",
  action: "Action",
  error: "Error",
};

function statePrompts(locked?: boolean, phoneLive?: boolean, tree?: UiTree | null): string[] {
  if (locked) return ["Unlock phone", "Dismiss popup", "Go home"];
  if (!phoneLive) return ["Wake phone", "Open Settings"];
  if (tree?.popup === 1) return ["Dismiss popup", "Open Settings", "Go home"];
  return ["Open Settings", "Open Chrome", "Dismiss popup", "Go home"];
}

interface Props {
  agent: Agent;
  tree: UiTree | null;
  disabled: boolean;
  connected: boolean;
  phoneLive: boolean;
  locked?: boolean;
}

export function AiPanel({ agent, tree, disabled, connected, phoneLive, locked }: Props) {
  const [prompt, setPrompt] = useState("");

  const submit = (text?: string) => {
    const p = (text ?? prompt).trim();
    if (!p || agent.running) return;
    setPrompt("");
    void agent.runPrompt(p, tree);
  };

  const quickPrompts = useMemo(() => statePrompts(locked, phoneLive, tree), [locked, phoneLive, tree]);

  const statusHint = !connected
    ? "Waiting for server connection…"
    : locked
      ? "Phone locked — AI will unlock automatically when you run a task"
      : !phoneLive
        ? "Phone offline — AI will wake and unlock when you run a task"
        : !tree
          ? "Screen not visible yet — AI will wake and unlock automatically"
          : "Describe what you want the phone to do";

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!agent.running || !agent.runStartedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [agent.running, agent.runStartedAt]);

  const elapsedSec = agent.runStartedAt
    ? Math.floor((Date.now() - agent.runStartedAt) / 1000)
    : 0;
  void tick;

  const copyLastRun = () => {
    const text = agent.logs.map((l) => `[${KIND_LABEL[l.kind] ?? l.kind}] ${l.text}`).join("\n");
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <h3>AI assistant</h3>
        <span className="ai-badge">DeepSeek Reasoner</span>
      </div>
      <p className="ai-desc">{statusHint}</p>

      {agent.running && (
        <p className="ai-run-metrics">
          Step {agent.runStep}/{agent.maxSteps}
          {agent.runStartedAt ? ` · ${elapsedSec}s` : ""}
        </p>
      )}

      <div className="ai-examples">
        <span className="ai-examples-label">Quick:</span>
        {quickPrompts.map((ex) => (
          <button
            key={ex}
            type="button"
            className="ai-example-btn"
            disabled={disabled}
            onClick={() => submit(ex)}
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="ai-prompt-row">
        <input
          type="text"
          placeholder='e.g. "open Instagram" or "turn on WiFi"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={disabled}
        />
        <button type="button" className="ai-run" disabled={disabled || !prompt.trim()} onClick={() => submit()}>
          {agent.running ? "Running…" : "Go"}
        </button>
      </div>

      <div className="ai-log">
        {agent.logs.length === 0 && (
          <p className="ai-log-empty">Activity log appears here. Use a quick prompt or type your own task.</p>
        )}
        {agent.logs.map((l) => (
          <div key={l.id} className={`ai-log-line ai-log-${l.role} ai-log-kind-${l.kind}`}>
            <span className="ai-log-badge">{KIND_LABEL[l.kind] ?? l.kind}</span>
            <span className="ai-log-text">{l.text}</span>
          </div>
        ))}
      </div>

      {agent.logs.length > 0 && (
        <div className="ai-log-actions">
          <button type="button" className="ai-clear" onClick={copyLastRun}>Copy last run</button>
          {agent.lastGoal && (
            <button
              type="button"
              className="ai-clear"
              disabled={disabled}
              onClick={() => void agent.runPrompt(agent.lastGoal, tree)}
            >
              Retry
            </button>
          )}
          <button type="button" className="ai-clear" onClick={agent.clearLogs}>Clear</button>
        </div>
      )}
    </div>
  );
}
