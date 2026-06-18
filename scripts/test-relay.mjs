#!/usr/bin/env node
/** End-to-end relay test without a physical device. */
import WebSocket from "ws";

const HOST = process.env.RELAY_HOST || "sapp-xoyi.onrender.com";
const BASE = `https://${HOST}`;
const WS_BASE = `wss://${HOST}`;

const deviceId = `emu-test-${Date.now()}`;
const deviceSecret = `secret-${Date.now()}-long-enough`;

async function main() {
  console.log("Host:", HOST);

  const health = await fetch(`${BASE}/api/health`);
  console.log("health:", health.status, await health.text());

  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "EmulatorTest",
      email: `emu${Date.now()}@test.local`,
      deviceId,
      deviceSecret,
      model: "sdk_gphone64_arm64",
    }),
  });
  const signupBody = await signup.json();
  console.log("signup:", signup.status, signupBody);
  if (!signupBody.ok) process.exit(1);

  const secret = signupBody.deviceSecret;
  const enc = (s) => encodeURIComponent(s);
  const wsUrl =
    `${WS_BASE}/ws?role=phone&device=${enc(deviceId)}&secret=${enc(secret)}` +
    `&name=${enc("EmulatorTest")}&model=${enc("sdk_gphone64_arm64")}`;

  const joined = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => {
      ws.close();
      reject(new Error("WS timeout"));
    }, 25_000);
    ws.on("open", () => console.log("phone WS: open"));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      console.log("phone WS msg:", msg.type);
      if (msg.type === "joined") {
        clearTimeout(t);
        resolve({ ws, msg });
      }
    });
    ws.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    ws.on("close", (code, reason) => console.log("phone WS close:", code, reason.toString()));
  });

  const { ws } = joined;
  for (let i = 0; i < 5; i++) {
    ws.send(JSON.stringify({ type: "heartbeat" }));
    await new Promise((r) => setTimeout(r, 800));
    const st = await fetch(`${BASE}/api/status`);
    const status = await st.json();
    console.log(`poll ${i}:`, status);
    if (status.onlineCount > 0) break;
  }
  const devices = await fetch(`${BASE}/api/devices`);
  const list = await devices.json();
  const mine = list.devices?.find((d) => d.deviceId === deviceId);
  console.log("device online (WS open):", mine?.online, mine?.name);
  ws.close();
  process.exit(mine?.online ? 0 : 1);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
