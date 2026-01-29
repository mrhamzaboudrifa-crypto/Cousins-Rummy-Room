// Cousins Rummy Room — Lobby + Name + Online Players + Chat (Firebase Realtime DB)

firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

const params = new URLSearchParams(location.search);
const roomId = params.get("room") || "cousins";
const roomRef = db.ref(`rooms/${roomId}`);

const app = document.getElementById("app");

let me = {
  uid: null,
  name: localStorage.getItem("crr_name") || `Guest${Math.floor(Math.random() * 999)}`
};

let latestPlayers = [];
let latestMessages = [];

const escapeHtml = (s) =>
  (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function roomLink() {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;
}

function render(players, messages) {
  app.innerHTML = `
    <div class="hdr">
      <div class="brand">
        <div class="title">Cousins</div>
        <div class="subtitle">Rummy Room</div>
        <div class="underline"></div>
      </div>
      <div class="exitMini" id="refreshBtn">Refresh</div>
    </div>

    <div class="panel" style="padding:12px;">
      <b>Your name</b>
      <div class="small">Save updates for everyone</div>
      <div style="height:10px"></div>
      <input
        id="nameInput"
        maxlength="16"
        value="${escapeHtml(me.name)}"
        style="
          width:100%;
          padding:12px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,.14);
          background: rgba(0,0,0,.25);
          color: rgba(240,248,255,.92);
          outline:none;
          font-size:16px;
        "
      />
      <div style="height:10px"></div>
      <button class="btn cyan" id="saveName">Save name</button>

      <div class="small" style="margin-top:12px;">
        Room link:
        <span id="roomLink" style="user-select:all; word-break:break-all;"></span>
      </div>
      <div style="height:10px"></div>
      <button class="btn" id="copyLink">Copy link</button>

      <div style="height:10px"></div>
      <button class="btn cyan" id="practiceBtn">Practice vs Bots</button>
    </div>

    <div class="panel" style="padding:12px; flex:1; min-height:0; display:flex; flex-direction:column; gap:12px;">
      <div>
        <b>Players online</b> <span class="small">(${players.length})</span>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px; overflow:auto; -webkit-overflow-scrolling:touch;">
        ${
          players.length
            ? players
                .map(
                  (p) => `
                    <div style="
                      padding:10px;
                      border-radius:14px;
                      border:1px solid rgba(160,210,255,.16);
                      background: rgba(0,0,0,.18);
                    ">
                      <b>${escapeHtml(p.name)}</b>
                      <span class="small"> — ${p.online ? "online" : "offline"}</span>
                    </div>
                  `
                )
                .join("")
            : `<div class="small">Nobody yet… Share the link above.</div>`
        }
      </div>
    </div>

    <div class="panel" style="padding:12px; flex:1; min-height:0; display:flex; flex-direction:column;">
      <b>Chat</b>

      <div id="chatBox" style="
        margin-top:10px;
        flex:1;
        min-height:0;
        overflow:auto;
        -webkit-overflow-scrolling:touch;
        display:flex;
        flex-direction:column;
        gap:8px;
        padding:10px;
        border-radius:14px;
        border:1px solid rgba(160,210,255,.12);
        background: rgba(0,0,0,.16);
      ">
        ${
          messages.length
            ? messages
                .map(
                  (m) => `
                    <div style="
                      padding:10px;
                      border-radius:14px;
                      border:1px solid rgba(255,255,255,.10);
                      background: rgba(255,255,255,.06);
                    ">
                      <b>${escapeHtml(m.name)}:</b>
                      <span class="small">${escapeHtml(m.text)}</span>
                    </div>
                  `
                )
                .join("")
            : `<div class="small">No messages yet…</div>`
        }
      </div>

      <div style="height:10px"></div>
      <input
        id="chatInput"
        placeholder="Type a message…"
        style="
          width:100%;
          padding:12px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,.14);
          background: rgba(0,0,0,.25);
          color: rgba(240,248,255,.92);
          outline:none;
          font-size:16px;
        "
      />
      <div style="height:10px"></div>
      <button class="btn" id="sendBtn">Send</button>
    </div>
  `;

  document.getElementById("roomLink").textContent = roomLink();

  document.getElementById("refreshBtn").onclick = () => location.reload();

  document.getElementById("copyLink").onclick = async () => {
    try {
      await navigator.clipboard.writeText(roomLink());
      alert("Link copied!");
    } catch {
      prompt("Copy this link:", roomLink());
    }
  };

  document.getElementById("practiceBtn").onclick = () => {
    location.href = `practice.html?bots=1&difficulty=easy`;
  };

  document.getElementById("saveName").onclick = async () => {
    const input = document.getElementById("nameInput");
    const name = (input.value || "").trim().slice(0, 16) || "Guest";
    me.name = name;
    localStorage.setItem("crr_name", name);
    if (me.uid) await roomRef.child(`players/${me.uid}/name`).set(name);
  };

  const send = async () => {
    const input = document.getElementById("chatInput");
    const text = (input.value || "").trim();
    if (!text) return;
    input.value = "";
    await roomRef.child("messages").push({
      uid: me.uid,
      name: me.name,
      text,
      ts: Date.now()
    });
  };

  document.getElementById("sendBtn").onclick = send;
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });

  // scroll chat to bottom
  setTimeout(() => {
    const box = document.getElementById("chatBox");
    if (box) box.scrollTop = box.scrollHeight;
  }, 0);
}

async function start() {
  const cred = await auth.signInAnonymously();
  me.uid = cred.user.uid;

  const playerRef = roomRef.child(`players/${me.uid}`);

  await playerRef.update({
    name: me.name,
    online: true,
    joinedAt: firebase.database.ServerValue.TIMESTAMP
  });

  playerRef.onDisconnect().update({
    online: false,
    lastSeen: firebase.database.ServerValue.TIMESTAMP
  });

  roomRef.child("players").on("value", (snap) => {
    const val = snap.val() || {};
    latestPlayers = Object.entries(val).map(([uid, p]) => ({
      uid,
      name: p.name || "Guest",
      online: !!p.online
    }));
    render(latestPlayers, latestMessages);
  });

  roomRef.child("messages").limitToLast(30).on("value", (snap) => {
    const val = snap.val() || {};
    latestMessages = Object.values(val).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    render(latestPlayers, latestMessages);
  });
}

render([], []);
start();