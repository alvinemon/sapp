import type { CommandFeedback } from "../types/device";

interface Props {
  feedback: CommandFeedback | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function LastCommandCard({ feedback, onRetry, onDismiss }: Props) {
  if (!feedback) return null;
  const ok = feedback.status === "ok";
  return (
    <div className={`last-command-card glass-panel last-command-${feedback.status}`}>
      <div className="last-command-head">
        <span className="last-command-label">{ok ? "Last command" : "Command failed"}</span>
        <span className={`last-command-status ${ok ? "ok" : "err"}`}>{ok ? "OK" : "Error"}</span>
      </div>
      <p className="last-command-text">
        <strong>{feedback.action}</strong>
        {feedback.detail ? ` — ${feedback.detail}` : ""}
      </p>
      <div className="last-command-actions">
        {!ok && onRetry && (
          <button type="button" className="last-command-retry" onClick={onRetry}>
            Retry
          </button>
        )}
        {onDismiss && (
          <button type="button" className="last-command-dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
