interface Props {
  lines?: number;
  title?: string;
}

/** Placeholder shimmer while phone data is loading or reconnecting. */
export function PanelSkeleton({ lines = 3, title }: Props) {
  return (
    <div className="panel-skeleton glass-panel" aria-busy="true" aria-label={title ?? "Loading"}>
      {title && <div className="skeleton-line skeleton-title" />}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  );
}
