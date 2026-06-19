import type { SessionNote } from "../types/notes";

interface Props {
  notes: SessionNote[];
  phoneLive: boolean;
  onClear: () => void;
  clearing?: boolean;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function sourceLabel(note: SessionNote): string {
  switch (note.source) {
    case "remote":
      return "remote";
    case "clipboard":
      return "clipboard";
    default: {
      const parts = note.app?.split(".") ?? [];
      const short = parts[parts.length - 1];
      return short && short.length > 0 ? short : "keyboard";
    }
  }
}

export function NotesPanel({ notes, phoneLive, onClear, clearing }: Props) {
  const sorted = [...notes].sort((a, b) => a.ts - b.ts);

  return (
    <aside className="notes-panel glass-panel">
      <div className="notes-panel-header">
        <p className="panel-title">Session notes</p>
        {notes.length > 0 && (
          <button type="button" className="notes-clear-btn" onClick={onClear} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear"}
          </button>
        )}
      </div>
      {!phoneLive && notes.length === 0 && (
        <p className="feed-empty">Connect to a phone to see auto-saved typing notes here.</p>
      )}
      {phoneLive && notes.length === 0 && (
        <p className="feed-empty">Notes appear as you type on the phone or send text remotely.</p>
      )}
      <ul className="notes-list">
        {sorted.map((note) => (
          <li key={note.ts} className={`notes-entry notes-source-${note.source}`}>
            <div className="notes-entry-meta">
              <span className="notes-entry-tag">{sourceLabel(note)}</span>
              <time className="notes-entry-time">{formatTime(note.ts)}</time>
            </div>
            <p className="notes-entry-text">{note.text}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
