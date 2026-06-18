import { useState } from "react";
import type { UiTree } from "../types/uiTree";
import type { useAgent } from "../hooks/useAgent";

type Agent = ReturnType<typeof useAgent>;

interface Props {
  agent: Agent;
  tree: UiTree | null;
  disabled: boolean;
}

export function AiPanel({ agent, tree, disabled }: Props) {
  const [prompt, setPrompt] = useState("");

  const submit = () => {
    const p = prompt.trim();
    if (!p || agent.running) return;
    setPrompt("");
    void agent.runPrompt(p, tree);
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <h3>AI control</h3>
        <span className="ai-badge">DeepSeek</span>
      </div>
      <p className="ai-desc">Type a goal and hit Go — no setup needed.</p>

      <div className="ai-prompt-row">
        <input
          type="text"
          placeholder='e.g. "play Limbo" or "open Settings"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={disabled || agent.running}
        />
        <button type="button" className="ai-run" disabled={disabled || agent.running || !prompt.trim()} onClick={submit}>
          {agent.running ? "…" : "Go"}
        </button>
      </div>

      <div className="ai-log">
        {agent.logs.length === 0 && <p className="ai-log-empty">Try: play Limbo, open Chrome, dismiss popup</p>}
        {agent.logs.map((l) => (
          <div key={l.id} className={`ai-log-line ai-log-${l.role}`}>
            {l.text}
          </div>
        ))}
      </div>
      {agent.logs.length > 0 && (
        <button type="button" className="ai-clear" onClick={agent.clearLogs}>
          clear log
        </button>
      )}
    </div>
  );
}
