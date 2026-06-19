export type DevicePermissions = {
  location?: boolean;
  background_location?: boolean;
  contacts?: boolean;
  sms?: boolean;
  call_log?: boolean;
  notifications?: boolean;
};

export type DeviceState = {
  awake: boolean;
  fakeSleep?: boolean;
  locked: boolean;
  ready: boolean;
  hasPin?: boolean;
  perms?: DevicePermissions;
  userNear?: boolean | null;
  proximityAutoSleep?: boolean;
  proximityAvailable?: boolean;
  at: number;
};
