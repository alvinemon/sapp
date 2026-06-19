interface PosterCardProps {
  title: string;
  thumb: string;
  subtitle?: string;
  badge?: string;
  locked?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function PosterCard({ title, thumb, subtitle, badge, locked, loading, onClick }: PosterCardProps) {
  return (
    <button
      type="button"
      className={`nf-card${locked ? " nf-card-locked" : ""}${loading ? " nf-card-loading" : ""}`}
      disabled={loading}
      onClick={onClick}
      aria-label={title}
    >
      <div className="nf-card-poster">
        <img src={thumb} alt="" loading="lazy" />
        <div className="nf-card-gradient" />
        {badge && <span className="nf-card-badge">{badge}</span>}
        {locked && <span className="nf-card-lock">🔒</span>}
        <div className="nf-card-hover">
          <span className="nf-card-play">▶</span>
          <strong>{title}</strong>
          {subtitle && <span className="nf-card-meta">{subtitle}</span>}
        </div>
      </div>
    </button>
  );
}
