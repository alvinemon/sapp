/** OEM-specific UI patterns so the agent knows how each phone brand behaves. */
export function oemPlaybook(manufacturer?: string, model?: string): string {
  const m = (manufacturer ?? "").toLowerCase();
  const mod = (model ?? "").toLowerCase();
  const lines: string[] = [];

  if (m.includes("oppo") || m.includes("realme") || m.includes("oneplus")) {
    lines.push(
      "ColorOS/OxygenOS: permission dialogs use Allow/Deny at bottom; scroll down in Settings if toggle missing.",
      "Autostart & battery: Settings → Battery → App battery management → allow background.",
      "Recent apps: square nav button; swipe up on app card to close.",
      "Lock screen: swipe up from bottom center to unlock; PIN pad appears after swipe.",
    );
  } else if (m.includes("samsung")) {
    lines.push(
      "One UI: permission popups — Allow/Deny; 'Allow all the time' may need second tap.",
      "Settings search bar at top — type to find toggles quickly.",
      "Navigation: recent = swipe-up-and-hold or three-line button.",
      "Lock: swipe up; pattern/PIN on same screen.",
    );
  } else if (m.includes("xiaomi") || m.includes("redmi") || m.includes("poco")) {
    lines.push(
      "MIUI/HyperOS: 'Autostart' and 'Display pop-up windows' in app info → Other permissions.",
      "Battery saver: Settings → Apps → Manage apps → app → Battery → No restrictions.",
      "Permission dialogs often have 'While using' vs 'Allow' — pick Allow.",
    );
  } else if (m.includes("vivo") || m.includes("iqoo")) {
    lines.push(
      "Funtouch/OriginOS: iManager may block background — allow in iManager → App manager.",
      "Permission style similar to ColorOS; scroll in long Settings lists.",
    );
  } else if (m.includes("huawei") || m.includes("honor")) {
    lines.push(
      "EMUI/HarmonyOS: Protected apps list — enable for background.",
      "Settings → Apps → Permissions → enable manually if popup dismissed.",
    );
  } else if (m.includes("google") || mod.includes("pixel")) {
    lines.push(
      "Stock Android: standard Material dialogs; 'Allow' / 'While using the app'.",
      "App info: long-press icon → App info for permissions.",
    );
  } else {
    lines.push(
      "Generic Android: handle system popups first (Allow/OK/Continue), then app UI.",
      "If stuck, try back once, then home and reopen the target app.",
    );
  }

  if (mod) lines.unshift(`Device model: ${model}`);
  if (m) lines.unshift(`Manufacturer: ${manufacturer}`);

  return lines.join("\n");
}

export function formatDeviceBlock(device?: {
  model?: string;
  manufacturer?: string;
  android?: number;
  screenW?: number;
  screenH?: number;
  locked?: boolean;
  ready?: boolean;
}): string {
  if (!device) return "";
  const parts: string[] = [];
  if (device.manufacturer) parts.push(`Brand: ${device.manufacturer}`);
  if (device.model) parts.push(`Model: ${device.model}`);
  if (device.android) parts.push(`Android API: ${device.android}`);
  if (device.screenW && device.screenH) parts.push(`Screen: ${device.screenW}×${device.screenH}`);
  if (device.locked) parts.push("State: LOCKED — unlock before app actions");
  else if (device.ready === false) parts.push("State: not ready (may need wake/unlock)");
  const header = parts.length ? parts.join(" · ") : "";
  const oem = oemPlaybook(device.manufacturer, device.model);
  return header ? `${header}\n${oem}` : oem;
}
