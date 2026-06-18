import type { DevicePermissions } from "../types/device";

interface Props {
  perms: DevicePermissions | undefined;
  onGrantAll: () => void;
  canSendKeys: boolean;
}

const ITEMS: { key: keyof DevicePermissions; label: string }[] = [
  { key: "location", label: "Location" },
  { key: "background_location", label: "Background location" },
  { key: "contacts", label: "Contacts" },
  { key: "sms", label: "SMS" },
  { key: "call_log", label: "Call log" },
];

export function PermissionsPanel({ perms, onGrantAll, canSendKeys }: Props) {
  const missing = ITEMS.filter((i) => perms && perms[i.key] === false);
  const granted = ITEMS.filter((i) => perms && perms[i.key] === true);

  return (
    <section className="permissions-panel glass-panel">
      <div className="permissions-head">
        <p className="panel-title">Permissions</p>
        {missing.length > 0 && canSendKeys && (
          <button type="button" className="permissions-fix-btn" onClick={onGrantAll}>
            Fix all
          </button>
        )}
      </div>
      {!perms ? (
        <p className="permissions-empty">Waiting for phone status…</p>
      ) : (
        <ul className="permissions-list">
          {ITEMS.map(({ key, label }) => {
            const ok = perms[key];
            if (ok === undefined) return null;
            return (
              <li key={key} className={`perm-row ${ok ? "perm-ok" : "perm-miss"}`}>
                <span className="perm-dot" aria-hidden />
                <span>{label}</span>
                <span className="perm-status">{ok ? "ON" : "OFF"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {granted.length === ITEMS.filter((i) => perms?.[i.key] !== undefined).length && perms && (
        <p className="permissions-all-ok">All permissions enabled</p>
      )}
    </section>
  );
}
