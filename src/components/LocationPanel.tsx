import type { LocationUpdate } from "../types/activity";

interface Props {
  location: LocationUpdate | null;
}

export function LocationPanel({ location }: Props) {
  if (!location) {
    return (
      <section className="location-panel glass-panel">
        <h3 className="feed-section-title">Where they are</h3>
        <p className="feed-empty">Location will appear when the phone moves.</p>
      </section>
    );
  }

  const mapsUrl = `https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=16/${location.lat}/${location.lng}`;
  const updated = location.at
    ? new Date(location.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <section className="location-panel glass-panel">
      <h3 className="feed-section-title">Where they are</h3>
      <p className="location-coords">
        {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
      </p>
      {location.accuracy != null && (
        <p className="location-meta">±{Math.round(location.accuracy)} m accuracy</p>
      )}
      {updated && <p className="location-meta">Updated {updated}</p>}
      <a className="location-link" href={mapsUrl} target="_blank" rel="noopener noreferrer">
        Open on map
      </a>
    </section>
  );
}
