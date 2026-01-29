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
    <div class="shell">
      <div class="title">Cousins</div>
      <div class="subtitle">Rummy Room</div>
      <div class="underline"></div>

      <div class="panel">
        <div class="row">
          <div>
            <b>Your name</b>
            <div class="small">Save updates for everyone</div>
          </div>
        </div>
        <div style="height:10px"></div>
        <input class="input" id="nameInput" maxlength="16" value="${escapeHtml(me.name)}" />
        <div style="height:10px"></div>
        <button class="btn cyan" id="saveName">Save name</button>

        <div class="small" style="margin-top:10px;">
          Room link:
          <span id="roomLink" style="user-select:all;"></span>
        </div>
        <div style="height:10px"></div>
        <button class="btn" id="copyLink">Copy link</button>

        <!-- ✅ STEP 4 ADDED: Practice button -->
        <div style="height:10px"></div>
        <button class="btn cyan" id="practiceBtn">Practice vs Bots</button>
      </div>

      <div class="panel">
        <b>Players online</b> <span class="small">(${players.length})</span>
        <div class="list">
          ${
            players.length
              ? players
                  .map(
                    (p) => `
              <div class="item">
                <b>${escapeHtml(p.name)}</b>
                <span class="small"> — ${p.online ? "online" : "offline"}</span>
              </div>`
                  )
                  .join("")
              : `<div class="small">Nobody yet… Share the link above.</div>`
          }
        </div>
      </div>

      <div class="panel">
        <b>Chat</b>
        <div class="chat" id="chatBox">
          ${
            messages.length
              ? messages
                  .map(
                    (m) => `
            <div class="item">
              <b>${escapeHtml(m.name)}:</b>
              <span class="small">${escapeHtml(m.text)}</span>
            </div>`
                  )
                  .join("")
              : `<div class="small">No messages yet…</div>`
          }
        </div>
        <div style="height:10px"></div>
        <input class="input" id="chatInput" placeholder="Type a message…" />
        <div style="height:10px"></div>
        <button class="btn" id="sendBtn">Send</button>
      </div>
    </div>
  `;

  document.getElementById("roomLink").textContent = roomLink();

  document.getElementById("copyLink").onclick = async () => {
    try {
      await navigator.clipboard.writeText(roomLink());
      alert("Link copied!");
    } catch {
      prompt("Copy this link:", roomLink());
    }
  };

  // ✅ STEP 4 ADDED: Practice link (default 1 bot + easy)
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