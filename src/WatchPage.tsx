import { useCallback, useEffect, useRef, useState } from "react";
import { useWatchSync } from "./hooks/useWatchSync";
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<YtPlayer | null>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const lastBroadcast = useRef(0);

  const { connected, peers, remoteUrl, sendState, sendUrl, onRemoteState, withApplying } = useWatchSync(room);

  const loadVideo = useCallback(
    (input: string) => {
      const resolved = resolveVideoUrl(input);
      if (!resolved) return;
      setVideo(resolved);
      setUrlInput(input);
      sendUrl(input);
    },
    [sendUrl],
  );

  useEffect(() => {
    if (remoteUrl && remoteUrl !== urlInput) loadVideo(remoteUrl);
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
        playerVars: { autoplay: 0, rel: 0, modestbranding: 1 },
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

  return (
    <div className="app watch-app">
      <div className="bg-glow bg-glow-1" />
      <div className="bg-glow bg-glow-2" />

      <header className="header">
        <div className="logo">
          <span className="logo-icon watch-logo">▶</span>
          <div>
            <h1>WatchRoom</h1>
            <p className="tagline">watch together</p>
          </div>
        </div>
        <div className="status-pills">
          <a className="pill pill-link" href="/control">remote</a>
          <span className={`pill ${connected ? "pill-live" : "pill-muted"}`}>
            {connected ? `● room ${room}` : "connecting…"}
          </span>
          <span className="pill pill-muted">{peers} viewer{peers !== 1 ? "s" : ""}</span>
        </div>
      </header>

      <main className="watch-main">
        <section className="watch-controls">
          <label className="watch-field">
            <span>Room code</span>
            <div className="watch-row">
              <input
                value={room}
                onChange={(e) => setRoom(e.target.value.toUpperCase())}
                maxLength={8}
                spellCheck={false}
              />
              <button type="button" onClick={() => setRoom(randomRoomCode())}>new</button>
            </div>
          </label>

          <label className="watch-field">
            <span>YouTube or Google Drive URL</span>
            <div className="watch-row">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://youtube.com/watch?v=… or drive.google.com/file/d/…"
              />
              <button type="button" onClick={() => loadVideo(urlInput)} disabled={!urlInput.trim()}>
                load
              </button>
            </div>
          </label>

          <p className="watch-hint">
            Share <strong>2hotatl.com/watch?room={room}</strong> so friends join the same room.
          </p>
        </section>

        <section className="watch-player-wrap">
          {!video ? (
            <div className="watch-empty">
              <span className="placeholder-emoji">▶</span>
              <p>Paste a YouTube or Google Drive link</p>
            </div>
          ) : video.kind === "youtube" ? (
            <div className="watch-yt">
              <div ref={ytContainerRef} className="watch-yt-frame" />
            </div>
          ) : (
            <video
              ref={videoRef}
              className="watch-video"
              src={video.playUrl}
              controls
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

          {video && (
            <div className="watch-transport">
              <button type="button" onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
              <input
                type="range"
                min={0}
                max={Math.max(time + 60, 120)}
                step={0.5}
                value={time}
                onChange={(e) => onSeek(Number(e.target.value))}
              />
              <span className="watch-time">{formatTime(time)}</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
