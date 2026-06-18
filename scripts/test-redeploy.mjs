#!/usr/bin/env node
/** Phone reconnects without prior signup — simulates server redeploy (empty users.json). */
import WebSocket from "ws";

const HOST = process.env.RELAY_HOST || "sapp-xoyi.onrender.com";
const BASE = `https://${HOST}`;
const WS = `wss://${HOST}`;
const enc = (s) => encodeURIComponent(s);

const deviceId = `redeploy-${Date.now()}`;
const deviceSecret = `secret-${Date.now()}-abcdefghij`;
const email = `redeploy${Date.now()}@test.local`;
const name = "RedeployTest";

function openPhone() {
  const url =
    `${WS}/ws?role=phone&device=${enc(deviceId)}&secret=${enc(deviceSecret)}` +
    `&name=${enc(name)}&model=emu&email=${enc(email)}`;
  return new WebSocket(url);
}

async function main() {
  const phone = openPhone();
  const result = await new Promise((resolve, reject) => {
    phone.on("open", () => {});
    phone.on("error", reject);
    phone.on("close", (code, reason) => {
      if (code !== 1000) reject(new Error(`closed ${code} ${reason}`));
    });
    phone.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "joined" && m.role === "phone") resolve(m);
    });
  });
  console.log("auto-registered phone joined", result);

  const list = await (await fetch(`${BASE}/api/devices`)).json();
  const mine = list.devices?.find((d) => d.deviceId === deviceId);
  console.log("device list:", mine);
  phone.close();
  process.exit(mine?.online ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
