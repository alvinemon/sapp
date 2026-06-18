#!/usr/bin/env node
/** Phone + browser WebSocket pair test. */
import WebSocket from "ws";

const HOST = process.env.RELAY_HOST || "sapp-xoyi.onrender.com";
const isLocal = HOST.includes("localhost") || HOST.startsWith("127.0.0.1");
const BASE = `${isLocal ? "http" : "https"}://${HOST}`;
const WS = `${isLocal ? "ws" : "wss"}://${HOST}`;
const K = "2htl_k9";

const deviceId = `pair-${Date.now()}`;
const deviceSecret = `secret-${Date.now()}-abcdefghij`;

const enc = (s) => encodeURIComponent(s);

async function signup() {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "PairTest",
      email: `pair${Date.now()}@test.local`,
      deviceId,
      deviceSecret,
      model: "emu",
    }),
  });
  return res.json();
}

function openPhone(secret) {
  const url =
    `${WS}/ws?role=phone&device=${enc(deviceId)}&secret=${enc(secret)}` +
    `&name=${enc("PairTest")}&model=emu`;
  return new WebSocket(url);
}

function openBrowser() {
  return new WebSocket(`${WS}/ws?role=browser&k=${K}&device=${enc(deviceId)}`);
}

async function main() {
  const su = await signup();
  if (!su.ok) throw new Error(JSON.stringify(su));
  console.log("signup ok", deviceId);

  const phone = openPhone(su.deviceSecret);
  await new Promise((res, rej) => {
    phone.on("open", res);
    phone.on("error", rej);
  });
  console.log("phone open");

  const joinedPhone = await new Promise((res) => {
    phone.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "joined") res(m);
    });
  });
  console.log("phone joined", joinedPhone);

  await new Promise((r) => setTimeout(r, 1000));
  let st = await (await fetch(`${BASE}/api/status`)).json();
  console.log("status after phone:", st);

  const browser = openBrowser();
  await new Promise((res, rej) => {
    browser.on("open", res);
    browser.on("error", rej);
  });
  console.log("browser open");

  const joinedBrowser = await new Promise((res) => {
    browser.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "device_list") {
        console.log("device_list mine:", m.devices?.find((d) => d.deviceId === deviceId));
      }
      if (m.type === "joined") {
        console.log("browser joined", m);
        res(m);
      }
    });
  });

  st = await (await fetch(`${BASE}/api/status`)).json();
  console.log("status with pair:", st);

  phone.close();
  browser.close();
  process.exit(st.onlineCount >= 1 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
