import { useCallback, useEffect, useState } from "react";
import type { OfferTemplate } from "../data/campaigns";

interface Props {
  adminKey: string;
  onApply?: (t: OfferTemplate) => void;
}

export function OfferTemplatesPanel({ adminKey, onApply }: Props) {
  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/offer-templates?editKey=${encodeURIComponent(adminKey)}`);
    if (!res.ok) throw new Error("load failed");
    const data = (await res.json()) as { templates: OfferTemplate[] };
    setTemplates(data.templates);
  }, [adminKey]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  return (
    <div className="glass-panel offer-templates-panel">
      <h3>Offer template gallery</h3>
      <p className="intel-muted">Pick a starting design for campaigns and individual sends.</p>
      {error && <p className="admin-error">{error}</p>}
      <div className="offer-template-grid">
        {templates.map((t) => (
          <article key={t.id} className="offer-template-card">
            <strong>{t.name}</strong>
            <p>{t.title}</p>
            <p className="intel-muted">{t.reason.slice(0, 80)}</p>
            {onApply && (
              <button type="button" className="ai-run" onClick={() => onApply(t)}>
                Use template
              </button>
            )}
          </article>
        ))}
        {templates.length === 0 && <p className="intel-muted">No templates yet.</p>}
      </div>
    </div>
  );
}
