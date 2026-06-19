export type ActivityItemType = "message" | "call" | "contact" | "typing" | "chat";

export interface ActivityItem {
  id?: string;
  type: ActivityItemType;
  app?: string;
  who?: string;
  preview?: string;
  at?: number;
}

export interface LocationUpdate {
  lat: number;
  lng: number;
  accuracy?: number;
  at?: number;
}

export interface ContactEntry {
  name: string;
  number: string;
}

export type WifiPresenceStatus = "alone" | "possible" | "others_nearby" | "crowded" | "wifi_off";

export interface WifiPeer {
  ip: string;
  mac: string;
}

export interface WifiPresenceUpdate {
  status: WifiPresenceStatus;
  nearbyAps: number;
  lanDevices: number;
  peopleEstimate: number;
  ssid?: string;
  peers?: WifiPeer[];
  waveScore?: number;
  motionDetected?: boolean;
  rssiStdDev?: number;
  rssiSwing?: number;
  motionBursts?: number;
  connectedRssi?: number;
  waveSeries?: number[];
  peopleFromWaves?: number;
  pulse?: boolean;
  at?: number;
}
