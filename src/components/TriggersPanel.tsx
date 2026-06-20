import { useCallback, useEffect, useState } from "react";

interface Trigger {
  id: string;
  name: string;
  enabled: boolean;
  when: { event: string; match?: { keyword?: string }; count?: number; windowHours?: number };
  then: { title: string; reason: string; body: string; delivery: string; cooldownHours: number };
  fireCount: number;
}

interface Props {
  adminKey: string;
}

export function TriggersPanel({ adminKey }: Props) {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/triggers?editKey=${encodeURIComponent(adminKey)}`);
    if (!res.ok) throw new Error("load failed");
    const data = (await res.json()) as { triggers: Trigger[] };
    setTriggers(data.triggers);
  }, [adminKey]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  const toggle = async (t: Trigger) => {
    await fetch("/api/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editKey: adminKey, ...t, enabled: !t.enabled }),
    });
    await reload();
  };

  return (
    <div className="glass-panel admin-section triggers-panel">
      <h2>Behavioral triggers</h2>
      <p className="intel-muted">Auto-fire offers when notification patterns match (runs every 5 min).</p>
      {error && <p className="admin-error">{error}</p>}
      <ul className="admin-list">
        {triggers.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong>
            <span>{t.when.event}</span>
            {t.when.match?.keyword && <span>/{t.when.match.keyword}/</span>}
            <span>→ {t.then.delivery}</span>
            <span>fired {t.fireCount}×</span>
            <button type="button" onClick={() => void toggle(t)}>
              {t.enabled ? "Disable" : "Enable"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
