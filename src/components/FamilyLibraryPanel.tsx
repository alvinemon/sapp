import { useCallback, useEffect, useState } from "react";
import {
  addFamilyLibraryItem,
  fetchFamilyLibrary,
  removeFamilyLibraryItem,
  type FamilyLibraryItem,
} from "../data/familyLibrary";

interface FamilyLibraryPanelProps {
  onPick: (item: FamilyLibraryItem) => void;
  loadingId: string | null;
}

const EDIT_KEY_STORAGE = "family_library_edit_key";

export function FamilyLibraryPanel({ onPick, loadingId }: FamilyLibraryPanelProps) {
  const [items, setItems] = useState<FamilyLibraryItem[]>([]);
  const [heading, setHeading] = useState("Family watch list");
  const [requiresKey, setRequiresKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editKey, setEditKey] = useState(() => sessionStorage.getItem(EDIT_KEY_STORAGE) ?? "");
  const [form, setForm] = useState({ title: "", description: "", thumbnail: "", url: "" });

  const reload = useCallback(() => {
    void fetchFamilyLibrary()
      .then((data) => {
        setItems(data.items);
        setHeading(data.title);
        setRequiresKey(data.requiresKey);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const submit = async () => {
    if (!form.title.trim() || !form.url.trim()) return;
    setBusy(true);
    try {
      sessionStorage.setItem(EDIT_KEY_STORAGE, editKey);
      await addFamilyLibraryItem({
        title: form.title,
        description: form.description,
        thumbnail: form.thumbnail || "https://placehold.co/300x450/1a1a2e/666688?text=Watch",
        url: form.url,
        editKey: editKey || undefined,
      });
      setForm({ title: "", description: "", thumbnail: "", url: "" });
      setShowForm(false);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await removeFamilyLibraryItem(id, editKey || undefined);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="family-library glass-panel">
      <div className="family-library-head">
        <div>
          <p className="panel-title">{heading}</p>
          <p className="family-library-sub">Drive, YouTube, or any link — synced for everyone in the room</p>
        </div>
        <button type="button" className="family-add-toggle" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add title"}
        </button>
      </div>

      {showForm && (
        <div className="family-form">
          {requiresKey && (
            <label className="family-field">
              <span>Edit key (if server requires it)</span>
              <input
                value={editKey}
                onChange={(e) => setEditKey(e.target.value)}
                placeholder="Optional — set LIBRARY_EDIT_KEY on server"
                type="password"
                autoComplete="off"
              />
            </label>
          )}
          <label className="family-field">
            <span>Title</span>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Movie or episode name"
            />
          </label>
          <label className="family-field">
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What's it about? Language, episode #, etc."
              rows={2}
            />
          </label>
          <label className="family-field">
            <span>Thumbnail URL</span>
            <input
              value={form.thumbnail}
              onChange={(e) => setForm((f) => ({ ...f, thumbnail: e.target.value }))}
              placeholder="https://… poster image (optional)"
            />
          </label>
          <label className="family-field">
            <span>Video link</span>
            <input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="Google Drive, YouTube, or direct MP4 URL"
            />
          </label>
          <button type="button" className="family-submit" disabled={busy || !form.title.trim() || !form.url.trim()} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save to library"}
          </button>
        </div>
      )}

      {error && <p className="free-catalog-error">{error}</p>}

      {items.length === 0 ? (
        <p className="family-empty">No titles yet — tap <strong>+ Add title</strong> with your Drive link.</p>
      ) : (
        <div className="family-grid">
          {items.map((item) => (
            <article key={item.id} className="family-card-wrap">
              <button
                type="button"
                className="free-card family-card"
                disabled={loadingId === item.id}
                onClick={() => onPick(item)}
              >
                <img
                  src={item.thumbnail}
                  alt=""
                  loading="lazy"
                  className="free-thumb"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "https://placehold.co/300x450/1a1a2e/666688?text=Watch";
                  }}
                />
                <div className="free-card-body">
                  <strong>{item.title}</strong>
                  {item.description && <p className="family-desc">{item.description}</p>}
                </div>
              </button>
              {showForm && (
                <button type="button" className="family-remove" disabled={busy} onClick={() => void remove(item.id)}>
                  Remove
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
