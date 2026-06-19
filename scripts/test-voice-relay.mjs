import WebSocket from "ws";

const KEY = "2htl_k9";
const ROOM = "TESTV";
const host = "wss://sapp-xoyi.onrender.com";
let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) {
    passed++;
    console.log("PASS:", name);
  } else {
    failed++;
    console.log("FAIL:", name);
  }
}

const results = { bGotPtt: false, bGotVoice: false, aEcho: false };
let aOpen = false;
let bOpen = false;
let aJoined = false;
let bJoined = false;

const a = new WebSocket(`${host}/ws/watch?room=${ROOM}&k=${KEY}`);
const b = new WebSocket(`${host}/ws/watch?room=${ROOM}&k=${KEY}`);

a.on("open", () => {
  aOpen = true;
  maybeSend();
});
b.on("open", () => {
  bOpen = true;
  maybeSend();
});

function maybeSend() {
  if (!aOpen || !bOpen) return;
  setTimeout(() => {
    a.send(JSON.stringify({ type: "voice_ptt", active: true, from: "SPEAKER_A" }));
    a.send(JSON.stringify({ type: "voice", data: "QUJD", from: "SPEAKER_A" }));
  }, 300);
}

a.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "joined") aJoined = true;
  if (msg.type === "voice_ptt" && msg.from === "SPEAKER_B") results.aEcho = true;
});

b.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "joined") bJoined = true;
  if (msg.type === "voice_ptt" && msg.from === "SPEAKER_A" && msg.active === true) results.bGotPtt = true;
  if (msg.type === "voice" && msg.from === "SPEAKER_A" && msg.data === "QUJD") results.bGotVoice = true;
});

a.on("error", (e) => console.log("A error:", e.message));
b.on("error", (e) => console.log("B error:", e.message));

setTimeout(() => {
  ok("client A connected", aOpen);
  ok("client B connected", bOpen);
  ok("both joined room", aJoined && bJoined);
  ok("voice_ptt relayed to peer", results.bGotPtt);
  ok("voice chunk relayed to peer", results.bGotVoice);
  ok("sender does not echo own ptt", !results.aEcho);
  a.close();
  b.close();
  console.log("---", `${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}, 8000);
