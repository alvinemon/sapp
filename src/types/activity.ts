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
