import { useCallback, useEffect, useState } from "react";
import {
  createSegment,
  deleteSegmentApi,
  fetchSegments,
  previewSegmentRules,
  SEGMENT_AREAS,
  SEGMENT_TAGS,
  type Segment,
  type SegmentRules,
} from "../data/segments";

interface Props {
  keys: { editKey?: string; marketingKey?: string };
  canDelete?: boolean;
}

const emptyRules = (): SegmentRules => ({});

export function SegmentBuilder({ keys, canDelete = !!keys.editKey }: Props) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<SegmentRules>(emptyRules());
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await fetchSegments(keys);
    setSegments(r.segments);
  }, [keys]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  useEffect(() => {
    const t = setTimeout(() => {
      void previewSegmentRules(keys, rules)
        .then((r) => setPreviewCount(r.count))
        .catch(() => setPreviewCount(null));
    }, 400);
    return () => clearTimeout(t);
  }, [keys, rules]);

  const toggleList = (field: "areas" | "tags" | "apps", value: string) => {
    setRules((r) => {
      const cur = r[field] ?? [];
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
      return { ...r, [field]: next.length ? next : undefined };
    });
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createSegment(keys, { name: name.trim(), description: description.trim() || undefined, rules });
      setName("");
      setDescription("");
      setRules(emptyRules());
      await reload();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-panel admin-section segment-builder">
      <h2>Segments</h2>
      <p className="intel-muted">Dynamic audiences — rules re-evaluate when you send campaigns.</p>
      {error && <p className="admin-error">{error}</p>}

      <div className="segment-preview">
        <strong>{previewCount ?? "…"} phones match</strong> current rules
      </div>

      <div className="admin-form-grid segment-rules">
        <input placeholder="Segment name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />

        <label className="segment-field">
          <span>Areas</span>
          <div className="segment-chips">
            {SEGMENT_AREAS.map((a) => (
              <button
                key={a}
                type="button"
                className={rules.areas?.includes(a) ? "active" : ""}
                onClick={() => toggleList("areas", a)}
              >
                {a}
              </button>
            ))}
          </div>
        </label>

        <label className="segment-field">
          <span>Tags</span>
          <div className="segment-chips">
            {SEGMENT_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                className={rules.tags?.includes(t) ? "active" : ""}
                onClick={() => toggleList("tags", t)}
              >
                {t}
              </button>
            ))}
          </div>
        </label>

        <label>
          Min activity score
          <input
            type="number"
            min={0}
            value={rules.minActivity ?? ""}
            onChange={(e) =>
              setRules((r) => ({
                ...r,
                minActivity: e.target.value ? parseInt(e.target.value, 10) : undefined,
              }))
            }
          />
        </label>

        <label>
          Keyword in notifications (regex)
          <input
            placeholder="order|cart|delivery"
            value={rules.keywordMatch ?? ""}
            onChange={(e) => setRules((r) => ({ ...r, keywordMatch: e.target.value || undefined }))}
          />
        </label>

        <label>
          Apps (comma-separated)
          <input
            placeholder="WhatsApp, bKash"
            value={rules.apps?.join(", ") ?? ""}
            onChange={(e) => {
              const apps = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              setRules((r) => ({ ...r, apps: apps.length ? apps : undefined }));
            }}
          />
        </label>

        <label className="segment-check">
          <input
            type="checkbox"
            checked={!!rules.onlineOnly}
            onChange={(e) => setRules((r) => ({ ...r, onlineOnly: e.target.checked || undefined }))}
          />
          Online only
        </label>

        <label>
          Last seen within (hours)
          <input
            type="number"
            min={1}
            value={rules.lastSeenWithinHours ?? ""}
            onChange={(e) =>
              setRules((r) => ({
                ...r,
                lastSeenWithinHours: e.target.value ? parseInt(e.target.value, 10) : undefined,
              }))
            }
          />
        </label>
      </div>

      <button type="button" className="ai-run" disabled={busy || !name.trim()} onClick={() => void save()}>
        Save segment
      </button>

      <h3>Saved segments ({segments.length})</h3>
      <ul className="admin-list">
        {segments.map((s) => (
          <li key={s.id}>
            <strong>{s.name}</strong>
            <span>{s.memberCount} devices</span>
            {s.description && <span className="intel-muted">{s.description}</span>}
            {canDelete && (
              <button type="button" onClick={() => void deleteSegmentApi(keys.editKey!, s.id).then(reload)}>
                Delete
              </button>
            )}
          </li>
        ))}
        {segments.length === 0 && <li className="intel-muted">No segments yet.</li>}
      </ul>
    </div>
  );
}
