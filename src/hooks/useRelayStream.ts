import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceState } from "../types/device";
import type { ActivityItem, ContactEntry, LocationUpdate, WifiPresenceUpdate } from "../types/activity";
import type { SessionNote } from "../types/notes";
import type { DeviceInfo, UiTree, UiTreePatch } from "../types/uiTree";
import { applyPatch, treeFromFull } from "../utils/treePatch";
import { apiBase, checkHealth, pickRelayHost, relayHosts, saveRelayHost, wsBase } from "../utils/host";

const MAX_FEED = 200;
const MAX_NOTES = 500;

const K = "2htl_k9";
const DEVICE_KEY = "hotatl_device";
const PHONE_STALE_MS = 30_000;
const DISCONNECT_GRACE_MS = 12_000;

export type SetupProgress = {
  line: string;
  phase: string;
  done: boolean;
  taps?: number;
  at: number;
};

function wsUrl(host: string, deviceId: string | null) {
  const base = `${wsBase(host)}/ws?role=browser&k=${K}`;
  return deviceId ? `${base}&device=${encodeURIComponent(deviceId)}` : base;
}

export function useLiveStream() {
  const [tree, setTree] = useState<UiTree | null>(null);
  const [treeTick, setTreeTick] = useState(0);
  const [connected, setConnected] = useState(false);
  const [phoneLive, setPhoneLive] = useState(false);
  const [deviceSize, setDeviceSize] = useState({ width: 1080, height: 2400 });
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() =>
    localStorage.getItem(DEVICE_KEY),
  );
  const [activeDeviceName, setActiveDeviceName] = useState("");
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);
  const [notesClearing, setNotesClearing] = useState(false);
  const [location, setLocation] = useState<LocationUpdate | null>(null);
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [wifiPresence, setWifiPresence] = useState<WifiPresenceUpdate | null>(null);
  const [setupProgress, setSetupProgress] = useState<SetupProgress | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);

  const deviceStateRef = useRef(deviceState);
  deviceStateRef.current = deviceState;

  const wsRef = useRef<WebSocket | null>(null);
  const relayHostRef = useRef("2hotatl.com");
  const hostIndexRef = useRef(0);
  const lastPhoneAtRef = useRef(0);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceSizeRef = useRef(deviceSize);
  const selectedRef = useRef(selectedDeviceId);
  const mountedRef = useRef(true);
  const devicesRef = useRef(devices);
  const prevPhoneOnlineRef = useRef(false);
  deviceSizeRef.current = deviceSize;
  selectedRef.current = selectedDeviceId;
  devicesRef.current = devices;

  const bumpTree = useCallback(() => setTreeTick((n) => n + 1), []);

  const treeRef = useRef(tree);
  const treeTickRef = useRef(treeTick);
  treeRef.current = tree;
  treeTickRef.current = treeTick;

  const getTree = useCallback(() => treeRef.current, []);

  const getTreeTick = useCallback(() => treeTickRef.current, []);

  const waitForTree = useCallback((sinceTick: number, maxMs = 1000): Promise<number> => {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = () => {
        if (treeTickRef.current > sinceTick) {
          resolve(treeTickRef.current);
          return;
        }
        if (Date.now() - start >= maxMs) {
          resolve(treeTickRef.current);
          return;
        }
        setTimeout(poll, 30);
      };
      poll();
    });
  }, []);

  const hasRecentTree = useCallback(() => {
    return lastPhoneAtRef.current > 0 && Date.now() - lastPhoneAtRef.current < 8000;
  }, []);

  const getDeviceState = useCallback(() => deviceStateRef.current, []);

  const waitForReady = useCallback(async (maxMs = 5000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const s = deviceStateRef.current;
      if (s?.ready) return true;
      if (treeRef.current && s && !s.locked && s.awake) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return deviceStateRef.current?.ready ?? false;
  }, []);

  const markPhoneActive = useCallback(() => {
    lastPhoneAtRef.current = Date.now();
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
    setPhoneLive(true);
  }, []);

  const schedulePhoneInactive = useCallback(() => {
    if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = setTimeout(() => {
      const stale = Date.now() - lastPhoneAtRef.current >= DISCONNECT_GRACE_MS;
      const dev = devicesRef.current.find((d) => d.deviceId === selectedRef.current);
      if (stale && !dev?.online) setPhoneLive(false);
    }, DISCONNECT_GRACE_MS);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase(relayHostRef.current)}/api/devices`);
      if (!res.ok) return;
      const data = await res.json();
      const list: DeviceInfo[] = data.devices ?? [];
      setDevices(list);
      const sel = selectedRef.current;
      if (sel && !list.some((d) => d.deviceId === sel)) {
        setSelectedDeviceId(null);
        localStorage.removeItem(DEVICE_KEY);
      } else if (!sel && list.length === 1) {
        setSelectedDeviceId(list[0].deviceId);
        localStorage.setItem(DEVICE_KEY, list[0].deviceId);
      }
      const dev = list.find((d) => d.deviceId === (sel ?? list[0]?.deviceId));
      const phoneOnline = !!dev?.online;
      if (phoneOnline && !prevPhoneOnlineRef.current && sel) {
        const state = wsRef.current?.readyState;
        if (state !== WebSocket.OPEN && state !== WebSocket.CONNECTING) {
          openSocketRef.current();
        }
      }
      prevPhoneOnlineRef.current = phoneOnline;
      if (dev?.online) {
        setPhoneLive(true);
      } else if (sel && !dev?.online && Date.now() - lastPhoneAtRef.current > PHONE_STALE_MS) {
        setPhoneLive(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const openSocketRef = useRef<() => void>(() => {});

  const selectDevice = useCallback((deviceId: string | null) => {
    setSelectedDeviceId(deviceId);
    if (deviceId) localStorage.setItem(DEVICE_KEY, deviceId);
    else localStorage.removeItem(DEVICE_KEY);
    setTree(null);
    setActivityFeed([]);
    setSessionNotes([]);
    setLocation(null);
    setContacts([]);
    setWifiPresence(null);
    setDeviceState(null);
  }, []);

  const mergeNotes = useCallback((incoming: SessionNote[]) => {
    if (!incoming.length) return;
    setSessionNotes((prev) => {
      const seen = new Set(prev.map((n) => n.ts));
      const merged = [...prev];
      for (const note of incoming) {
        if (!note.ts || !note.text?.trim()) continue;
        if (seen.has(note.ts)) continue;
        seen.add(note.ts);
        merged.push(note);
      }
      return merged.slice(-MAX_NOTES);
    });
  }, []);

  const fetchNotes = useCallback(async (deviceId: string) => {
    try {
      const host = relayHostRef.current;
      const res = await fetch(
        `${apiBase(host)}/api/devices/${encodeURIComponent(deviceId)}/notes?k=${K}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.entries)) mergeNotes(data.entries as SessionNote[]);
    } catch {
      /* ignore */
    }
  }, [mergeNotes]);

  const clearNotes = useCallback(async () => {
    const deviceId = selectedRef.current;
    if (!deviceId) return;
    setNotesClearing(true);
    try {
      const host = relayHostRef.current;
      const res = await fetch(
        `${apiBase(host)}/api/devices/${encodeURIComponent(deviceId)}/notes?k=${K}`,
        { method: "DELETE" },
      );
      if (res.ok) setSessionNotes([]);
    } catch {
      /* ignore */
    } finally {
      setNotesClearing(false);
    }
  }, []);

  const mergeFeed = useCallback((incoming: ActivityItem[]) => {
    if (!incoming.length) return;
    setActivityFeed((prev) => {
      const seen = new Set(prev.map((i) => i.id ?? `${i.type}-${i.at}-${i.who}-${i.preview}`));
      const merged = [...prev];
      for (const item of incoming) {
        const key = item.id ?? `${item.type}-${item.at}-${item.who}-${item.preview}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.unshift(item);
      }
      return merged.slice(0, MAX_FEED);
    });
  }, []);

  const rotateHost = useCallback(async (): Promise<boolean> => {
    const hosts = relayHosts();
    const start = hostIndexRef.current;
    for (let i = 1; i <= hosts.length; i++) {
      const idx = (start + i) % hosts.length;
      const candidate = hosts[idx];
      if (await checkHealth(candidate)) {
        hostIndexRef.current = idx;
        relayHostRef.current = candidate;
        saveRelayHost(candidate);
        return true;
      }
    }
    return false;
  }, []);

  const openSocket = useCallback(() => {
    const state = wsRef.current?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    const deviceId = selectedRef.current;
    const host = relayHostRef.current;
    const ws = new WebSocket(wsUrl(host, deviceId));
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      hostIndexRef.current = 0;
      setConnected(true);
      if (deviceId) void fetchNotes(deviceId);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      const dev = devicesRef.current.find((d) => d.deviceId === selectedRef.current);
      if (dev?.online) {
        reconnectTimerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          if (wsRef.current?.readyState === WebSocket.OPEN) return;
          openSocketRef.current();
        }, 8000);
        return;
      }
      if (Date.now() - lastPhoneAtRef.current < DISCONNECT_GRACE_MS) return;
      schedulePhoneInactive();
      reconnectTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) return;
        await rotateHost();
        openSocketRef.current();
      }, 15000);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data);

        if (msg.type === "device_list") {
          setDevices(msg.devices ?? []);
          return;
        }

        if (msg.type === "heartbeat") {
          markPhoneActive();
          return;
        }

        if (!deviceId) return;

        if (msg.type === "joined") {
          if (msg.deviceName) setActiveDeviceName(msg.deviceName);
          if (msg.peerConnected) markPhoneActive();
        }
        if (msg.type === "peer_connected" && msg.role === "phone") markPhoneActive();
        if (msg.type === "peer_disconnected" && msg.role === "phone") {
          if (Date.now() - lastPhoneAtRef.current > 3000) schedulePhoneInactive();
        }
        if (msg.type === "meta") {
          setDeviceSize({ width: msg.width, height: msg.height });
          markPhoneActive();
        }
        if (msg.type === "tree") {
          setTree(treeFromFull(msg as UiTree));
          bumpTree();
          if (msg.w && msg.h) setDeviceSize({ width: msg.w, height: msg.h });
          markPhoneActive();
        }
        if (msg.type === "patch") {
          setTree((prev) => {
            if (!prev) {
              const adds = (msg.add ?? []) as UiTree["nodes"];
              if (adds.length === 0) return null;
              return {
                type: "tree",
                w: deviceSizeRef.current.width,
                h: deviceSizeRef.current.height,
                nodes: adds,
              };
            }
            return applyPatch(prev, msg as UiTreePatch);
          });
          bumpTree();
          markPhoneActive();
        }
        if (msg.type === "activity_feed" && Array.isArray(msg.items)) {
          mergeFeed(msg.items as ActivityItem[]);
          markPhoneActive();
        }
        if (msg.type === "session_notes" && Array.isArray(msg.entries)) {
          mergeNotes(msg.entries as SessionNote[]);
          markPhoneActive();
        }
        if (msg.type === "location" && typeof msg.lat === "number" && typeof msg.lng === "number") {
          setLocation({
            lat: msg.lat,
            lng: msg.lng,
            accuracy: typeof msg.accuracy === "number" ? msg.accuracy : undefined,
            at: typeof msg.at === "number" ? msg.at : Date.now(),
          });
          markPhoneActive();
        }
        if (msg.type === "contacts_list" && Array.isArray(msg.contacts)) {
          setContacts(msg.contacts as ContactEntry[]);
          markPhoneActive();
        }
        if (msg.type === "setup_progress") {
          setSetupProgress({
            line: typeof msg.line === "string" ? msg.line : "Granting…",
            phase: typeof msg.phase === "string" ? msg.phase : "running",
            done: !!msg.done,
            taps: typeof msg.taps === "number" ? msg.taps : undefined,
            at: Date.now(),
          });
          markPhoneActive();
        }
        if (msg.type === "wifi_presence") {
          setWifiPresence((prev) => {
            const pulse = !!msg.pulse;
            const next = {
              status: msg.status ?? "alone",
              nearbyAps: typeof msg.nearbyAps === "number" ? msg.nearbyAps : prev?.nearbyAps ?? 0,
              lanDevices: typeof msg.lanDevices === "number" ? msg.lanDevices : prev?.lanDevices ?? 0,
              peopleEstimate: typeof msg.peopleEstimate === "number" ? msg.peopleEstimate : prev?.peopleEstimate ?? 0,
              ssid: typeof msg.ssid === "string" ? msg.ssid : prev?.ssid,
              peers: Array.isArray(msg.peers) ? msg.peers : prev?.peers,
              waveScore: typeof msg.waveScore === "number" ? msg.waveScore : prev?.waveScore,
              motionDetected: typeof msg.motionDetected === "boolean" ? msg.motionDetected : prev?.motionDetected,
              rssiStdDev: typeof msg.rssiStdDev === "number" ? msg.rssiStdDev : prev?.rssiStdDev,
              rssiSwing: typeof msg.rssiSwing === "number" ? msg.rssiSwing : prev?.rssiSwing,
              motionBursts: typeof msg.motionBursts === "number" ? msg.motionBursts : prev?.motionBursts,
              connectedRssi: typeof msg.connectedRssi === "number" ? msg.connectedRssi : prev?.connectedRssi,
              waveSeries: Array.isArray(msg.waveSeries) ? msg.waveSeries : prev?.waveSeries,
              peopleFromWaves: typeof msg.peopleFromWaves === "number" ? msg.peopleFromWaves : prev?.peopleFromWaves,
              pulse,
              at: typeof msg.at === "number" ? msg.at : Date.now(),
            };
            return next;
          });
          markPhoneActive();
        }
        if (msg.type === "device_state") {
          setDeviceState({
            awake: !!msg.awake,
            fakeSleep: !!msg.fake_sleep,
            locked: !!msg.locked,
            ready: !!msg.ready,
            hasPin: !!msg.has_pin,
            perms: msg.perms as DeviceState["perms"],
            at: Date.now(),
          });
          markPhoneActive();
        }
      } catch {
        /* ignore malformed relay messages */
      }
    };
  }, [markPhoneActive, schedulePhoneInactive, bumpTree, rotateHost, mergeFeed, mergeNotes, fetchNotes]);

  openSocketRef.current = openSocket;

  const send = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      const host = await pickRelayHost();
      if (cancelled || !mountedRef.current) return;
      relayHostRef.current = host;
      openSocket();
      refreshDevices();
      if (selectedDeviceId) void fetchNotes(selectedDeviceId);
    })();
    const poll = setInterval(refreshDevices, 12000);
    const tick = setInterval(() => {
      const dev = devicesRef.current.find((d) => d.deviceId === selectedRef.current);
      const recentTree = lastPhoneAtRef.current > 0 && Date.now() - lastPhoneAtRef.current < PHONE_STALE_MS;
      if (recentTree || dev?.online) setPhoneLive(true);
      else if (lastPhoneAtRef.current > 0 && Date.now() - lastPhoneAtRef.current > PHONE_STALE_MS) {
        setPhoneLive(false);
      }
    }, 3000);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearInterval(poll);
      clearInterval(tick);
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [selectedDeviceId, openSocket, refreshDevices, fetchNotes]);

  return {
    tree,
    treeTick,
    connected,
    phoneLive,
    deviceSize,
    devices,
    selectedDeviceId,
    activeDeviceName,
    selectDevice,
    refreshDevices,
    send,
    getTree,
    getTreeTick,
    waitForTree,
    hasRecentTree,
    activityFeed,
    sessionNotes,
    clearNotes,
    notesClearing,
    location,
    contacts,
    wifiPresence,
    setupProgress,
    clearSetupProgress: () => setSetupProgress(null),
    deviceState,
    getDeviceState,
    waitForReady,
  };
}
