import { useEffect, useMemo, useState } from "react";
import { fetchFreeCatalog, type FreeCatalogItem } from "../data/freeCatalog";

interface FreeCatalogPanelProps {
  onPick: (item: FreeCatalogItem) => void;
  loadingId: string | null;
}

export function FreeCatalogPanel({ onPick, loadingId }: FreeCatalogPanelProps) {
  const [items, setItems] = useState<FreeCatalogItem[]>([]);
  const [source, setSource] = useState("");
  const [filter, setFilter] = useState<"all" | "movie" | "tv">("all");
  const [category, setCategory] = useState("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchFreeCatalog()
      .then((data) => {
        setItems(data.items);
        setSource(data.source);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  const categories = useMemo(
    () => ["all", ...new Set(items.map((i) => i.category))].sort(),
    [items],
  );

  const shown = items.filter((i) => {
    if (filter !== "all" && i.kind !== filter) return false;
    if (category !== "all" && i.category !== category) return false;
    return true;
  });

  return (
    <section className="free-catalog glass-panel">
      <div className="free-catalog-head">
        <div>
          <p className="panel-title">Free to watch</p>
          <p className="free-catalog-sub">{source || "Public domain movies & shows"}</p>
        </div>
        <div className="free-catalog-filters">
          {(["all", "movie", "tv"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`free-filter ${filter === k ? "free-filter-active" : ""}`}
              onClick={() => setFilter(k)}
            >
              {k === "all" ? "All" : k === "movie" ? "Movies" : "Shows"}
            </button>
          ))}
        </div>
      </div>

      {categories.length > 2 && (
        <div className="free-category-row">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`free-cat ${category === c ? "free-cat-active" : ""}`}
              onClick={() => setCategory(c)}
            >
              {c === "all" ? "Every genre" : c}
            </button>
          ))}
        </div>
      )}

      {error && <p className="free-catalog-error">{error}</p>}

      <div className="free-grid">
        {shown.map((item) => (
          <button
            key={item.id}
            type="button"
            className="free-card"
            disabled={loadingId === item.id}
            onClick={() => onPick(item)}
          >
            <img src={item.thumb} alt="" loading="lazy" className="free-thumb" />
            <div className="free-card-body">
              <span className="free-kind">{item.kind === "movie" ? "Movie" : "Show"}</span>
              <strong>{item.title}</strong>
              <span className="free-meta">
                {item.year} · {item.category}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
