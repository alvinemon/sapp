import { useMemo, useState } from "react";
import type { ContactEntry } from "../types/activity";
import type { DevicePermissions } from "../types/device";
import { PermissionNudge } from "./PermissionNudge";

interface Props {
  contacts: ContactEntry[];
  perms?: DevicePermissions;
  canSendKeys: boolean;
  onRequestPermission: (step: string) => void;
}

export function ContactsPanel({ contacts, perms, canSendKeys, onRequestPermission }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts.slice(0, 80);
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.number.includes(q),
    ).slice(0, 80);
  }, [contacts, query]);

  return (
    <section className="contacts-panel glass-panel">
      <h3 className="feed-section-title">Contacts</h3>
      {contacts.length > 0 && (
        <input
          type="search"
          className="contacts-search"
          placeholder="Search names or numbers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {contacts.length === 0 ? (
        perms?.contacts === false ? (
          <PermissionNudge
            label="Enable contacts to invite friends to a watch room in one tap."
            step="contacts"
            canSendKeys={canSendKeys}
            onRequest={onRequestPermission}
          />
        ) : (
          <p className="feed-empty">Contact list syncs from the phone.</p>
        )
      ) : (
        <ul className="contacts-list">
          {filtered.map((c, i) => (
            <li key={`${c.number}-${i}`} className="contact-row">
              <strong>{c.name || "Unknown"}</strong>
              <span>{c.number}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
