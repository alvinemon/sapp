interface WatchHeroProps {
  title: string;
  description: string;
  thumb: string;
  onPlay: () => void;
  onInfo?: () => void;
}

export function WatchHero({ title, description, thumb, onPlay, onInfo }: WatchHeroProps) {
  return (
    <section className="nf-hero">
      <div className="nf-hero-bg" style={{ backgroundImage: `url(${thumb})` }} />
      <div className="nf-hero-vignette" />
      <div className="nf-hero-content">
        <p className="nf-hero-eyebrow">Featured</p>
        <h1 className="nf-hero-title">{title}</h1>
        <p className="nf-hero-desc">{description}</p>
        <div className="nf-hero-actions">
          <button type="button" className="nf-btn nf-btn-play" onClick={onPlay}>
            <span className="nf-btn-icon">▶</span>
            Play
          </button>
          {onInfo && (
            <button type="button" className="nf-btn nf-btn-secondary" onClick={onInfo}>
              More Info
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
