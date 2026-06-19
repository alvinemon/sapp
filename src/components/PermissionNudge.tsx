interface Props {
  label: string;
  step: string;
  canSendKeys: boolean;
  onRequest: (step: string) => void;
}

export function PermissionNudge({ label, step, canSendKeys, onRequest }: Props) {
  return (
    <div className="perm-nudge">
      <p className="perm-nudge-text">{label}</p>
      <button
        type="button"
        className="perm-nudge-btn"
        disabled={!canSendKeys}
        onClick={() => onRequest(step)}
      >
        Enable on phone
      </button>
    </div>
  );
}
