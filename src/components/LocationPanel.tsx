import type { LocationUpdate } from "../types/activity";
import type { DevicePermissions } from "../types/device";
import { PermissionNudge } from "./PermissionNudge";

interface Props {
  location: LocationUpdate | null;
  perms?: DevicePermissions;
  canSendKeys: boolean;
  onRequestPermission: (step: string) => void;
}

export function LocationPanel({ location, perms, canSendKeys, onRequestPermission }: Props) {
  if (!location) {
    return (
      <section className="location-panel glass-panel">
        <h3 className="feed-section-title">Where they are</h3>
        {perms?.location === false ? (
          <PermissionNudge
            label="Turn on location so you can see when they're home and ready for movie night."
            step="location"
            canSendKeys={canSendKeys}
            onRequest={onRequestPermission}
          />
        ) : (
          <p className="feed-empty">Location will appear when the phone moves.</p>
        )}
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
