import type { ScreenAction, ScreenGuideModel } from "../utils/screenGuide";

interface Props {
  guide: ScreenGuideModel;
  onAction: (action: ScreenAction) => void;
}

function ActionList({
  title,
  hint,
  items,
  variant,
  onAction,
}: {
  title: string;
  hint?: string;
  items: ScreenAction[];
  variant: "popup" | "main";
  onAction: (a: ScreenAction) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className={`guide-section guide-${variant}`}>
      <h3>{title}</h3>
      {hint && <p className="guide-hint">{hint}</p>}
      <ul className="guide-list">
        {items.map((a) => (
          <li key={`${variant}-${a.num}`}>
            <button type="button" className="guide-row" onClick={() => onAction(a)}>
              <span className="guide-num">{a.num}</span>
              <span className="guide-body">
                <strong>{a.label}</strong>
                <span className="guide-instr">{a.instruction}</span>
              </span>
              <span className="guide-kind">{a.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ScreenGuide({ guide, onAction }: Props) {
  return (
    <div className="screen-guide">
      <div className="guide-header">
        <h2>{guide.title}</h2>
        <p className="guide-summary">{guide.summary}</p>
      </div>

      {guide.reading.length > 0 && (
        <section className="guide-section guide-reading">
          <h3>On screen</h3>
          <ul className="guide-reading-list">
            {guide.reading.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <ActionList
        title="⚠ Popup — do this first"
        hint="These buttons are on top of the app. Tap one to dismiss or confirm."
        items={guide.popupActions}
        variant="popup"
        onAction={onAction}
      />

      <ActionList
        title="What you can do"
        hint="Each row sends the same tap to your phone."
        items={guide.actions}
        variant="main"
        onAction={onAction}
      />
    </div>
  );
}
