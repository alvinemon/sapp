import { useState } from "react";
import type { UiTree } from "../types/uiTree";
import type { useAgent } from "../hooks/useAgent";

type Agent = ReturnType<typeof useAgent>;

const EXAMPLES = [
  "Open Chrome",
  "Open Settings",
  "Dismiss popup",
  "Go home",
  "Play Limbo",
];

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

  const statusHint = !connected
    ? "Waiting for server connection…"
    : locked
      ? "Phone locked — AI will unlock automatically when you run a task"
      : !phoneLive
        ? "Phone offline — AI will wake and unlock when you run a task"
        : !tree
          ? "Screen not visible yet — AI will wake and unlock automatically"
          : "Describe what you want the phone to do";

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <h3>AI assistant</h3>
        <span className="ai-badge">DeepSeek</span>
      </div>
      <p className="ai-desc">{statusHint}</p>
      <p className="ai-how">Type a goal and press Go. The AI reads the screen and taps for you — no setup needed.</p>

      <div className="ai-examples">
        <span className="ai-examples-label">Try:</span>
        {EXAMPLES.map((ex) => (
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
          <p className="ai-log-empty">Activity log appears here. Tap an example above or type your own task.</p>
        )}
        {agent.logs.map((l) => (
          <div key={l.id} className={`ai-log-line ai-log-${l.role}`}>
            {l.text}
          </div>
        ))}
      </div>
      {agent.logs.length > 0 && (
        <button type="button" className="ai-clear" onClick={agent.clearLogs}>
          Clear log
        </button>
      )}
    </div>
  );
}
