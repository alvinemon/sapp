import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceInfo, UiTree, UiTreePatch } from "../types/uiTree";
import { applyPatch, treeFromFull } from "../utils/treePatch";
import { apiBase, checkHealth, pickRelayHost, relayHosts, saveRelayHost, wsBase } from "../utils/host";

const K = "2htl_k9";
const DEVICE_KEY = "hotatl_device";
const PHONE_STALE_MS = 30_000;
const DISCONNECT_GRACE_MS = 12_000;

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

  const waitForTree = useCallback((sinceTick: number, maxMs = 2000): Promise<number> => {
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
        setTimeout(poll, 50);
      };
      poll();
    });
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
      } catch {
        /* ignore malformed relay messages */
      }
    };
  }, [markPhoneActive, schedulePhoneInactive, bumpTree, rotateHost]);

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
  }, [selectedDeviceId, openSocket, refreshDevices]);

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
  };
}
