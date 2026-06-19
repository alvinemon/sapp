#!/usr/bin/env node
/** Install + automate Watch Together on emulator, verify relay + commands. */
import { execFileSync, spawnSync } from "node:child_process";
import WebSocket from "ws";

const HOST = process.env.RELAY_HOST || "sapp-xoyi.onrender.com";
const BASE = `https://${HOST}`;
const WS_BASE = `wss://${HOST}`;
const K = "2htl_k9";
const ADB = process.env.ADB || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PKG = "com.phonehand.app";
const A11Y = `${PKG}/com.phonehand.app.TouchAccessibilityService`;

function adb(...args) {
  return execFileSync(ADB, args, { encoding: "utf8" }).trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("=== Emulator app test ===");
  console.log("Relay:", HOST);

  const devices = adb("devices").split("\n").filter((l) => l.includes("device") && !l.startsWith("List"));
  if (!devices.length) {
    console.error("FAIL: no emulator/device connected");
    process.exit(1);
  }
  console.log("Device:", devices[0]);

  // Fresh install only when CLEAR=1
  if (process.env.CLEAR === "1") {
    adb("shell", "am", "force-stop", PKG);
    adb("shell", "pm", "clear", PKG);
    await sleep(500);
  }

  // Enable accessibility via adb (required for relay)
  adb("shell", "settings", "put", "secure", "accessibility_enabled", "1");
  adb("shell", "settings", "put", "secure", "enabled_accessibility_services", A11Y);
  await sleep(300);

  adb("shell", "am", "start", "-n", `${PKG}/.HomeActivity`);
  await sleep(3000);

  // Onboarding: enable accessibility prompt + finish setup (approx tap coords for 1080x2400)
  adb("shell", "input", "tap", "540", "1650");
  await sleep(1500);
  adb("shell", "input", "tap", "540", "1650");
  await sleep(8000);
  adb("shell", "input", "tap", "540", "1900");
  await sleep(8000);

  const logcat = spawnSync(ADB, ["logcat", "-d", "-s", "Relay:D"], { encoding: "utf8" }).stdout;
  const relayLines = logcat.split("\n").filter((l) => l.includes("connect"));
  console.log("Logcat relay:", relayLines.slice(-3).join("\n") || "(none)");

  let deviceId = null;
  for (let i = 0; i < 20; i++) {
    const list = await fetch(`${BASE}/api/devices`).then((r) => r.json());
    const online = list.devices?.filter((d) => d.online && d.model?.includes("sdk_gphone")) ?? [];
    console.log(`Poll ${i + 1}: ${online.length} emulator(s) online`);
    if (online.length) {
      deviceId = online[0].deviceId;
      break;
    }
    await sleep(3000);
  }

  if (!deviceId) {
    console.error("FAIL: phone not online on relay after launch");
    process.exit(1);
  }
  console.log("Using device:", deviceId.slice(0, 12));

  const wsUrl = `${WS_BASE}/ws?role=browser&k=${K}&device=${encodeURIComponent(deviceId)}`;
  let cmdResult = null;
  try {
    cmdResult = await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const t = setTimeout(() => {
        ws.close();
        reject(new Error("browser WS timeout"));
      }, 20_000);
      ws.on("open", () => {
        console.log("Browser WS open, sending home command…");
        ws.send(JSON.stringify({ type: "key", action: "home" }));
      });
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "command_feedback") {
          clearTimeout(t);
          resolve(msg);
          ws.close();
        }
        if (msg.type === "joined") console.log("Browser joined, peer:", msg.peerConnected);
      });
      ws.on("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  } catch {
    console.log("No command_feedback for home (checking open_app…)");
  }

  console.log("Command feedback:", cmdResult);

  // Fallback: verify command actually ran on device
  adb("shell", "am", "start", "-n", `${PKG}/.HomeActivity`);
  await sleep(1500);
  adb("shell", "input", "tap", "540", "1200");
  await sleep(500);
  const focusBefore = adb("shell", "dumpsys", "window", "windows").includes("Settings");
  const ws2 = new WebSocket(wsUrl);
  await new Promise((resolve) => {
    const t = setTimeout(() => { ws2.close(); resolve(null); }, 15000);
    ws2.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "joined") {
        ws2.send(JSON.stringify({ type: "open_app", package: "com.android.settings" }));
      }
      if (msg.type === "command_feedback") {
        clearTimeout(t);
        resolve(msg);
        ws2.close();
      }
    });
  });
  await sleep(2000);
  const focusAfter = adb("shell", "dumpsys", "window", "windows").includes("Settings");
  const cmdWorked = focusAfter;
  console.log("Settings opened via relay:", cmdWorked);

  const ok = cmdResult?.status === "ok" || cmdWorked;
  console.log(ok ? "PASS: relay commands work" : "FAIL: command did not run");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
