import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContentRow } from "./components/watch/ContentRow";
import { PosterCard } from "./components/watch/PosterCard";
import { WatchHero } from "./components/watch/WatchHero";
import { VoiceChatPanel } from "./components/VoiceChatPanel";
import { PaywallModal } from "./components/PaywallModal";
import type { FamilyLibraryItem } from "./data/familyLibrary";
import { fetchFamilyLibrary } from "./data/familyLibrary";
import type { PremiumItem, PaymentMethod } from "./data/premium";
import { fetchPremium, fetchPaymentMethods } from "./data/premium";
import type { FreeCatalogItem } from "./data/freeCatalog";
import { fetchFreeCatalog } from "./data/freeCatalog";
import { useWatchSync } from "./hooks/useWatchSync";
import { fetchCatalog, fetchPublishedOffers, type Offer } from "./data/catalog";
import { recordOfferEvent } from "./data/campaigns";
import { randomRoomCode, resolveVideoUrl, type ResolvedVideo } from "./utils/videoUrl";

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: string | HTMLElement,
        opts: {
          videoId: string;
          playerVars?: Record<string, number | string>;
          events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
        },
      ) => YtPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YtPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (s: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
}

const YT_PLAYING = 1;
const PLACEHOLDER_THUMB = "https://placehold.co/1280x720/1a1a1a/e50914?text=2hotatl";

function loadYtApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
}

export default function WatchPage() {
  const [room, setRoom] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("room")?.toUpperCase() || randomRoomCode();
  });
  const [urlInput, setUrlInput] = useState("");
  const [video, setVideo] = useState<ResolvedVideo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [showRoomBar, setShowRoomBar] = useState(false);
  const [paywallItem, setPaywallItem] = useState<PremiumItem | null>(null);

  const [freeItems, setFreeItems] = useState<FreeCatalogItem[]>([]);
  const [familyItems, setFamilyItems] = useState<FamilyLibraryItem[]>([]);
  const [premiumItems, setPremiumItems] = useState<PremiumItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [continueItems, setContinueItems] = useState(loadContinueWatching);

  const videoRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<YtPlayer | null>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const lastBroadcast = useRef(0);

  const [loadingPickId, setLoadingPickId] = useState<string | null>(null);

  const [publishedOffers, setPublishedOffers] = useState<Offer[]>([]);
  const [paywallOffer, setPaywallOffer] = useState<{ offerId?: string; campaignId?: string; deviceId?: string }>({});

  const {
    connected,
    peers,
    participants,
    youId,
    remoteUrl,
    sendState,
    sendUrl,
    onRemoteState,
    withApplying,
    startHostHeartbeat,
  } = useWatchSync(room);

  useEffect(() => {
    void fetchCatalog().then((d) => {
      const free = d.items.filter((i) => i.free && i.type === "movie");
      setFreeItems(
        free.map((i) => ({
          id: i.id,
          title: i.title,
          year: i.year ?? 2024,
          category: i.category ?? "Catalog",
          kind: "movie" as const,
          streamUrl: i.url ?? "",
          thumb: i.thumb,
        })),
      );
      const prem = d.items.filter((i) => !i.free);
      setPremiumItems(
        prem.map((i) => ({
          id: i.id,
          title: i.title,
          description: i.description,
          thumbnail: i.thumb,
          price: i.price ?? "",
          currency: i.currency ?? "BDT",
          methodIds: i.methodIds ?? [],
          locked: i.locked ?? true,
          url: i.url,
        })),
      );
    }).catch(() => {});
    void fetchFreeCatalog().then((d) => setFreeItems((prev) => (prev.length ? prev : d.items))).catch(() => {});
    void fetchFamilyLibrary().then((d) => setFamilyItems(d.items)).catch(() => {});
    void fetchPremium().then((d) => setPremiumItems((prev) => (prev.length ? prev : d.items))).catch(() => {});
    void fetchPaymentMethods().then(setPaymentMethods).catch(() => {});
    void fetchPublishedOffers().then((d) => {
      setPublishedOffers(d.offers);
      for (const o of d.offers) {
        void recordOfferEvent(o.id, o.deviceId || "web", "impression", {
          campaignId: o.campaignId,
          variantId: o.variantId,
        });
      }
    }).catch(() => {});
  }, []);

  const featured = useMemo(() => {
    if (video?.title) {
      return {
        title: video.title,
        description: "Now playing in your room — invite friends to watch together.",
        thumb: freeItems[0]?.thumb ?? familyItems[0]?.thumbnail ?? PLACEHOLDER_THUMB,
      };
    }
    const pick = freeItems[0] ?? familyItems[0];
    if (pick) {
      const isFree = "kind" in pick;
      return {
        title: pick.title,
        description: isFree
          ? `${(pick as FreeCatalogItem).year} · ${(pick as FreeCatalogItem).category} — free to stream`
          : (pick as FamilyLibraryItem).description || "Family pick — tap Play to start",
        thumb: isFree ? (pick as FreeCatalogItem).thumb : (pick as FamilyLibraryItem).thumbnail,
      };
    }
    return {
      title: "Movies & Shows",
      description: "Free classics, family links, and premium titles — watch together in sync.",
      thumb: PLACEHOLDER_THUMB,
    };
  }, [video, freeItems, familyItems]);

  const trackContinue = useCallback(
    (id: string, title: string, thumb: string, url: string, source: "free" | "family" | "premium" | "link") => {
      saveContinueWatching({ id, title, thumb, url, source });
      setContinueItems(loadContinueWatching());
    },
    [],
  );

  const loadVideo = useCallback(
    async (
      input: string,
      resolved?: ResolvedVideo,
      meta?: { id: string; thumb: string; source: "free" | "family" | "premium" | "link" },
    ) => {
      let v = resolved ?? resolveVideoUrl(input);
      if (!v) return;
      if (v.kind === "archive") {
        const m = input.match(/archive\.org\/details\/([a-zA-Z0-9._-]+)/i);
        const id = m?.[1];
        if (id) {
          const res = await fetch(`/api/free-catalog/resolve/${encodeURIComponent(id)}`);
          if (res.ok) {
            const data = (await res.json()) as { streamUrl?: string; item?: { title?: string } };
            if (data.streamUrl) {
              v = { kind: "direct", playUrl: data.streamUrl, title: data.item?.title };
            }
          }
        }
      }
      if (v.kind === "archive") return;
      setVideo(v);
      setUrlInput(input);
      sendUrl(v.playUrl);
      if (meta) {
        trackContinue(meta.id, v.title ?? meta.id, meta.thumb, input, meta.source);
      }
    },
    [sendUrl, trackContinue],
  );

  const loadFamilyItem = useCallback(
    async (item: FamilyLibraryItem) => {
      setLoadingPickId(item.id);
      try {
        await loadVideo(item.url, undefined, {
          id: item.id,
          thumb: item.thumbnail,
          source: "family",
        });
      } finally {
        setLoadingPickId(null);
      }
    },
    [loadVideo],
  );

  const loadPremiumItem = useCallback(
    async (item: PremiumItem, attribution?: { offerId?: string; campaignId?: string; deviceId?: string }) => {
      if (item.locked || !item.url) {
        setPaywallOffer(attribution ?? {});
        setPaywallItem(item);
        return;
      }
      setLoadingPickId(item.id);
      try {
        await loadVideo(item.url, undefined, {
          id: item.id,
          thumb: item.thumbnail,
          source: "premium",
        });
      } finally {
        setLoadingPickId(null);
      }
    },
    [loadVideo],
  );

  const loadFreeItem = useCallback(
    async (item: FreeCatalogItem) => {
      setLoadingPickId(item.id);
      try {
        let streamUrl = item.streamUrl;
        const res = await fetch(`/api/free-catalog/resolve/${encodeURIComponent(item.id)}`);
        if (res.ok) {
          const data = (await res.json()) as { streamUrl?: string };
          if (data.streamUrl) streamUrl = data.streamUrl;
        }
        await loadVideo(
          streamUrl,
          { kind: "direct", playUrl: streamUrl, title: item.title },
          { id: item.id, thumb: item.thumb, source: "free" },
        );
      } finally {
        setLoadingPickId(null);
      }
    },
    [loadVideo],
  );

  const handleOfferClick = useCallback(
    (o: Offer) => {
      void recordOfferEvent(o.id, o.deviceId || "web", "click", {
        campaignId: o.campaignId,
        variantId: o.variantId,
      });
      const attr = { offerId: o.id, campaignId: o.campaignId, deviceId: o.deviceId };
      if (o.contentId) {
        const prem = premiumItems.find((i) => i.id === o.contentId);
        if (prem) {
          void loadPremiumItem(prem, attr);
          return;
        }
        const free = freeItems.find((i) => i.id === o.contentId);
        if (free) {
          void loadFreeItem(free);
          return;
        }
      }
    },
    [freeItems, premiumItems, loadFreeItem, loadPremiumItem],
  );

  const playFeatured = () => {
    if (video) return;
    if (freeItems[0]) void loadFreeItem(freeItems[0]);
    else if (familyItems[0]) void loadFamilyItem(familyItems[0]);
  };

  useEffect(() => {
    if (!remoteUrl || remoteUrl === urlInput) return;
    const resolved = resolveVideoUrl(remoteUrl);
    if (resolved?.kind === "archive") {
      void (async () => {
        const m = remoteUrl.match(/archive\.org\/details\/([a-zA-Z0-9._-]+)/i);
        const id = m?.[1];
        if (!id) return;
        const res = await fetch(`/api/free-catalog/resolve/${encodeURIComponent(id)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { streamUrl?: string };
        if (data.streamUrl) loadVideo(data.streamUrl, { kind: "direct", playUrl: data.streamUrl });
      })();
      return;
    }
    loadVideo(remoteUrl, resolved ?? undefined);
  }, [remoteUrl, urlInput, loadVideo]);

  useEffect(() => {
    onRemoteState((s) => {
      withApplying(() => {
        setPlaying(s.playing);
        setTime(s.t);
        if (video?.kind === "youtube" && ytRef.current) {
          ytRef.current.seekTo(s.t, true);
          if (s.playing) ytRef.current.playVideo();
          else ytRef.current.pauseVideo();
        } else if (videoRef.current) {
          videoRef.current.currentTime = s.t;
          if (s.playing) void videoRef.current.play();
          else videoRef.current.pause();
        }
      });
    });
  }, [onRemoteState, withApplying, video]);

  useEffect(() => {
    if (!video || video.kind !== "youtube" || !ytContainerRef.current) return;
    let player: YtPlayer | null = null;
    let cancelled = false;

    void loadYtApi().then(() => {
      if (cancelled || !ytContainerRef.current) return;
      player = new window.YT!.Player(ytContainerRef.current, {
        videoId: video.playUrl,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1 },
        events: {
          onStateChange: (e) => {
            const isPlaying = e.data === YT_PLAYING;
            setPlaying(isPlaying);
            if (player) {
              const t = player.getCurrentTime();
              setTime(t);
              sendState({ t, playing: isPlaying });
            }
          },
        },
      });
      ytRef.current = player;
    });

    return () => {
      cancelled = true;
      ytRef.current = null;
    };
  }, [video, sendState]);

  useEffect(() => {
    const tick = setInterval(() => {
      let t = 0;
      let isPlaying = playing;
      if (video?.kind === "youtube" && ytRef.current) {
        t = ytRef.current.getCurrentTime();
        isPlaying = ytRef.current.getPlayerState() === YT_PLAYING;
      } else if (videoRef.current) {
        t = videoRef.current.currentTime;
        isPlaying = !videoRef.current.paused;
      } else return;

      setTime(t);
      const now = Date.now();
      if (now - lastBroadcast.current > 800) {
        lastBroadcast.current = now;
        sendState({ t, playing: isPlaying });
      }
    }, 500);
    return () => clearInterval(tick);
  }, [video, playing, sendState]);

  const togglePlay = () => {
    if (video?.kind === "youtube" && ytRef.current) {
      if (playing) ytRef.current.pauseVideo();
      else ytRef.current.playVideo();
    } else if (videoRef.current) {
      if (videoRef.current.paused) void videoRef.current.play();
      else videoRef.current.pause();
    }
  };

  const onSeek = (t: number) => {
    if (video?.kind === "youtube" && ytRef.current) {
      ytRef.current.seekTo(t, true);
    } else if (videoRef.current) {
      videoRef.current.currentTime = t;
    }
    setTime(t);
    sendState({ t, playing });
  };

  const closePlayer = () => {
    setVideo(null);
    setPlaying(false);
    setTime(0);
  };

  return (
    <div className="netflix-watch">
      <header className="nf-nav">
        <div className="nf-nav-left">
          <a href="/" className="nf-logo">
            <span className="nf-logo-mark">2</span>hotatl
          </a>
          <nav className="nf-nav-links">
            <a href="/watch" className="nf-nav-active">Movies</a>
            <a href="/">Remote</a>
          </nav>
        </div>
        <div className="nf-nav-right">
          <button type="button" className="nf-room-toggle" onClick={() => setShowRoomBar((v) => !v)}>
            {connected ? `Room ${room}` : "Join room"}
          </button>
          <span className="nf-peers">{peers} watching</span>
        </div>
      </header>

      {showRoomBar && (
        <div className="nf-room-bar">
          <label>
            <span>Room code</span>
            <div className="nf-room-row">
              <input
                value={room}
                onChange={(e) => setRoom(e.target.value.toUpperCase())}
                maxLength={8}
                spellCheck={false}
              />
              <button type="button" onClick={() => setRoom(randomRoomCode())}>New</button>
            </div>
          </label>
          <label>
            <span>Paste a link</span>
            <div className="nf-room-row">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="YouTube, Drive, archive.org…"
              />
              <button type="button" onClick={() => void loadVideo(urlInput)} disabled={!urlInput.trim()}>
                Load
              </button>
            </div>
          </label>
          <p className="nf-room-hint">
            Share <strong>2hotatl.com/watch?room={room}</strong> to watch together.
          </p>
        </div>
      )}

      <WatchHero
        title={featured.title}
        description={featured.description}
        thumb={featured.thumb}
        onPlay={video ? togglePlay : playFeatured}
      />

      <main className="nf-main">
        {continueItems.length > 0 && (
          <ContentRow title="Continue Watching">
            {continueItems.map((item) => (
              <PosterCard
                key={item.id}
                title={item.title}
                thumb={item.thumb}
                subtitle="Resume"
                loading={loadingPickId === item.id}
                onClick={() => void loadVideo(item.url, undefined, { id: item.id, thumb: item.thumb, source: item.source })}
              />
            ))}
          </ContentRow>
        )}

        {freeItems.length > 0 && (
          <ContentRow title="Free Movies">
            {freeItems.map((item) => (
              <PosterCard
                key={item.id}
                title={item.title}
                thumb={item.thumb}
                subtitle={`${item.year} · ${item.category}`}
                badge={item.kind === "tv" ? "Series" : undefined}
                loading={loadingPickId === item.id}
                onClick={() => void loadFreeItem(item)}
              />
            ))}
          </ContentRow>
        )}

        {familyItems.length > 0 && (
          <ContentRow title="Family Library">
            {familyItems.map((item) => (
              <PosterCard
                key={item.id}
                title={item.title}
                thumb={item.thumbnail}
                subtitle={item.description?.slice(0, 60)}
                loading={loadingPickId === item.id}
                onClick={() => void loadFamilyItem(item)}
              />
            ))}
          </ContentRow>
        )}

        {premiumItems.length > 0 && (
          <ContentRow title="Premium">
            {premiumItems.map((item) => (
              <PosterCard
                key={item.id}
                title={item.title}
                thumb={item.thumbnail}
                subtitle={item.locked ? `${item.price} ${item.currency}` : "Unlocked"}
                locked={item.locked}
                badge={item.locked ? "Premium" : undefined}
                loading={loadingPickId === item.id}
                onClick={() => void loadPremiumItem(item)}
              />
            ))}
          </ContentRow>
        )}

        <section className="nf-voice-section">
          <VoiceChatPanel roomCode={room} compact participants={participants} youId={youId} />
        </section>

        {publishedOffers.length > 0 && (
          <ContentRow title="Recommended for you">
            {publishedOffers.map((o) => (
              <div
                key={o.id}
                className="nf-offer-card glass-panel"
                role="button"
                tabIndex={0}
                onClick={() => handleOfferClick(o)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleOfferClick(o);
                }}
              >
                <strong>{o.title}</strong>
                <p>{o.reason}</p>
              </div>
            ))}
          </ContentRow>
        )}
      </main>

      {video && (
        <div className="nf-player-overlay" role="dialog" aria-label="Now playing">
          <div className="nf-player-top">
            <button type="button" className="nf-player-close" onClick={closePlayer} aria-label="Close player">
              ✕
            </button>
            <span className="nf-player-title">{video.title ?? "Now playing"}</span>
          </div>
          <div className="nf-player-stage">
            {video.kind === "youtube" ? (
              <div className="nf-yt-wrap">
                <div ref={ytContainerRef} className="nf-yt-frame" />
              </div>
            ) : (
              <video
                ref={videoRef}
                className="nf-video"
                src={video.playUrl}
                controls
                autoPlay
                playsInline
                onPlay={() => {
                  setPlaying(true);
                  sendState({ t: videoRef.current?.currentTime ?? 0, playing: true });
                }}
                onPause={() => {
                  setPlaying(false);
                  sendState({ t: videoRef.current?.currentTime ?? 0, playing: false });
                }}
                onSeeked={() => {
                  const t = videoRef.current?.currentTime ?? 0;
                  setTime(t);
                  sendState({ t, playing: !videoRef.current?.paused });
                }}
              />
            )}
          </div>
          <div className="nf-transport">
            <button type="button" className="nf-btn nf-btn-play nf-transport-play" onClick={togglePlay}>
              {playing ? "❚❚" : "▶"}
            </button>
            <input
              type="range"
              className="nf-seek"
              min={0}
              max={Math.max(time + 60, 120)}
              step={0.5}
              value={time}
              onChange={(e) => onSeek(Number(e.target.value))}
            />
            <span className="nf-time">{formatTime(time)}</span>
          </div>
        </div>
      )}

      {paywallItem && (
        <PaywallModal
          item={paywallItem}
          methods={
            paywallItem.methodIds.length
              ? paymentMethods.filter((m) => paywallItem.methodIds.includes(m.id))
              : paymentMethods
          }
          onClose={() => {
            setPaywallItem(null);
            setPaywallOffer({});
          }}
          onUnlocked={(unlocked) => {
            setPaywallItem(null);
            setPaywallOffer({});
            void loadPremiumItem(unlocked);
          }}
          offerId={paywallOffer.offerId}
          campaignId={paywallOffer.campaignId}
          deviceId={paywallOffer.deviceId}
        />
      )}
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
