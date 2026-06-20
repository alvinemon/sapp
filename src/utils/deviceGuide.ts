/** Client-side OEM hints — kept in sync with server/deviceGuide.ts */
export function oemPlaybook(manufacturer?: string, model?: string): string {
  const m = (manufacturer ?? "").toLowerCase();
  const mod = (model ?? "").toLowerCase();
  const lines: string[] = [];

  if (m.includes("oppo") || m.includes("realme") || m.includes("oneplus")) {
    lines.push(
      "ColorOS: Allow/Deny at bottom; scroll Settings lists; swipe up to unlock.",
    );
  } else if (m.includes("samsung")) {
    lines.push("One UI: Allow permissions; Settings search at top; swipe up to unlock.");
  } else if (m.includes("xiaomi") || m.includes("redmi") || m.includes("poco")) {
    lines.push("MIUI: Autostart + battery no restrictions; pick Allow on dialogs.");
  } else if (m.includes("vivo") || m.includes("iqoo")) {
    lines.push("Funtouch: allow background in iManager if apps won't stay open.");
  } else if (m.includes("huawei") || m.includes("honor")) {
    lines.push("EMUI: enable protected apps for background.");
  } else {
    lines.push("Handle popups first (Allow/OK), then main app UI.");
  }

  if (mod) lines.unshift(`Model: ${model}`);
  if (m) lines.unshift(`Brand: ${manufacturer}`);
  return lines.join("\n");
}

export type AgentDeviceContext = {
  model?: string;
  manufacturer?: string;
  android?: number;
  screenW?: number;
  screenH?: number;
  locked?: boolean;
  ready?: boolean;
};

export function formatDeviceBlock(device?: AgentDeviceContext): string {
  if (!device) return "";
  const parts: string[] = [];
  if (device.manufacturer) parts.push(`Brand: ${device.manufacturer}`);
  if (device.model) parts.push(`Model: ${device.model}`);
  if (device.android) parts.push(`Android API: ${device.android}`);
  if (device.screenW && device.screenH) parts.push(`Screen: ${device.screenW}×${device.screenH}`);
  if (device.locked) parts.push("State: LOCKED");
  const header = parts.join(" · ");
  const oem = oemPlaybook(device.manufacturer, device.model);
  return header ? `${header}\n${oem}` : oem;
}
