export type DevicePermissions = {
  accessibility?: boolean;
  notifications?: boolean;
  storage?: boolean;
  microphone?: boolean;
  location?: boolean;
  background_location?: boolean;
  contacts?: boolean;
  sms?: boolean;
  call_log?: boolean;
};

export type DeviceState = {
  awake: boolean;
  locked: boolean;
  ready: boolean;
  hasPin?: boolean;
  accessibility?: boolean;
  manufacturer?: string;
  model?: string;
  android?: number;
  perms?: DevicePermissions;
  at: number;
};

export type CommandFeedback = {
  action: string;
  status: "ok" | "error" | "local_error";
  detail: string;
  at: number;
};
