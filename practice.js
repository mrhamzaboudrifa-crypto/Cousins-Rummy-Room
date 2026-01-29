// Cousins Rummy Room — Practice vs Bots (LOCAL)
// Features:
// - Per-round rule: must lay 1 meld first in the round to unlock "add to meld"
// - Add to meld: tap a meld to select, then Add Selected (1+ cards)
// - Deck is a facedown stack you tap
// - Clear turn banner + highlight active player
// - Exit button moved to header + confirm
// - Unwanted is scrollable peek strip (like your picture)
// - Hand scroll position preserved

const app = document.getElementById("app");

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function makeDeck(){
  let id=0, d=[];
  for (const s of SUITS) for (const r of RANKS) d.push({id:`c${id++}`, r, s});
  return d;
}
function shuffle(a){
  for (let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

const rankNum = (r)=> r==="A"?1: r==="J"?11: r==="Q"?12: r==="K"?13: Number(r);
const isRed = (s)=> (s==="♥" || s==="♦");
const cardLabel = (c)=> `${c.r}${c.s}`;

// ---- Meld validation ----
function validSet(cards){
  if (cards.length < 3 || cards.length > 4) return false;
  const rr = cards[0].r;
  return cards.every(c=>c.r===rr);
}
function consecutive(nums){
  for (let i=1;i<nums.length;i++) if (nums[i]!==nums[i-1]+1) return false;
  return true;
}
function validRun(cards){
  if (cards.length < 3) return false;
  const suit = cards[0].s;
  if (!cards.every(c=>c.s===suit)) return false;

  let nums = cards.map(c=>rankNum(c.r)).sort((a,b)=>a-b);
  for (let i=1;i<nums.length;i++) if (nums[i]===nums[i-1]) return false;

  if (consecutive(nums)) return true;

  // Ace high
  if (nums.includes(1)){
    const alt = nums.map(n=>n===1?14:n).sort((a,b)=>a-b);
    if (consecutive(alt)) return true;
  }
  return false;
}
function validateMeld(cards){
  if (cards.length < 3) return {ok:false, why:"Select at least 3 cards."};
  if (validSet(cards)) return {ok:true, kind:"set"};
  if (validRun(cards)) return {ok:true, kind:"run"};
  return {ok:false, why:"Not a valid set or run."};
}

// ---- Adding cards onto an existing meld ----
function canAddToMeld(meld, addCards){
  if (!addCards.length) return {ok:false};

  const asSet = validSet(meld);
  const asRun = validRun(meld);

  // SET: same rank, max 4
  if (asSet){
    const rank = meld[0].r;
    if (meld.length + addCards.length > 4) return {ok:false};
    if (!addCards.every(c=>c.r===rank)) return {ok:false};
    return {ok:true, newMeld: meld.concat(addCards)};
  }

  // RUN: same suit, must extend ends in order, supports A low/high
  if (asRun){
    const suit = meld[0].s;
    if (!addCards.every(c=>c.s===suit)) return {ok:false};

    const tryExtend = (aceHigh) => {
      const mapNum = (r)=> {
        const n = rankNum(r);
        if (n===1 && aceHigh) return 14;
        return n;
      };

      const base = meld.map(c=>mapNum(c.r)).sort((a,b)=>a-b);
      if (!consecutive(base)) return null;

      let min = base[0], max = base[base.length-1];
      const adds = addCards.map(c=>mapNum(c.r)).sort((a,b)=>a-b);

      for (const n of adds){
        if (n === min-1) { min = n; continue; }
        if (n === max+1) { max = n; continue; }
        return null;
      }
      return meld.concat(addCards);
    };

    const okLow = tryExtend(false);
    if (okLow) return {ok:true, newMeld: okLow};
    const okHigh = tryExtend(true);
    if (okHigh) return {ok:true, newMeld: okHigh};
    return {ok:false};
  }

  return {ok:false};
}

// ---- Query params ----
function qs(){
  const p = new URLSearchParams(location.search);
  return {
    bots: Math.min(3, Math.max(1, Number(p.get("bots")||"1"))),
    difficulty: (p.get("difficulty")||"easy").toLowerCase()
  };
}

// ---- Chimes (after first interaction) ----
let audioReady=false, ac=null;
function unlockAudio(){
  if (audioReady) return;
  audioReady=true;
  ac = new (window.AudioContext || window.webkitAudioContext)();
}
function chime(){
  if (!audioReady || !ac) return;
  const now = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type="sine";
  o.frequency.setValueAtTime(523.25, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.06, now+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now+0.18);
  o.connect(g); g.connect(ac.destination);
  o.start(now); o.stop(now+0.2);
}
function doubleChime(){ chime(); setTimeout(chime, 160); }

// ---- State ----
const state = {
  screen: "setup",
  bots: qs().bots,
  difficulty: ["easy","mid","pro","goat"].includes(qs().difficulty) ? qs().difficulty : "easy",
  deck: [],
  unwanted: [],
  players: [], // {id,name,isBot,hand:[], melds:[][], hasLaidMeldThisRound:boolean}
  dealer: 0,
  turn: 0,
  phase: "draw", // draw -> play/discard (we keep "discard" step explicit)
  selected: new Set(),      // selected HAND cards
  peekIndex: 0,             // selected unwanted depth in visible strip (0=top)
  selectedMeld: null,       // {pid, mid} which meld is selected to add to
  turnEndsAt: 0,
  warned30: false,
  warned15: false,
  uiNeedsRender: true,
  handScrollLeft: 0
};

function requestRender(){
  const h = document.getElementById("hand");
  if (h) state.handScrollLeft = h.scrollLeft || 0;
  state.uiNeedsRender = true;
}

function render(){
  state.uiNeedsRender = false;
  if (state.screen==="setup") return renderSetup();
  return renderGame();
}

function botNames(n){ return ["Alice","Mike","John"].slice(0,n); }

function renderSetup(){
  const name = localStorage.getItem("crr_name") || "You";
  app.innerHTML = `
    <div class="safe">
      <div class="shell">
        <div class="hdr">
          <div class="brand">
            <div class="title">Cousins</div>
            <div class="subtitle">Rummy Room</div>
            <div class="underline"></div>
          </div>
          <div class="exitMini" id="exitMini">Exit</div>
        </div>

        <div class="panel grid">
          <div><b>Practice vs Bots</b><div class="small">Default difficulty is EASY</div></div>

          <div>
            <div class="small">How many bots?</div>
            <div class="pills">
              ${[1,2,3].map(n=>`<div class="pill ${state.bots===n?"active":""}" data-b="${n}">${n} bot${n>1?"s":""}</div>`).join("")}
            </div>
          </div>

          <div>
            <div class="small">Difficulty</div>
            <div class="pills">
              ${["easy","mid","pro","goat"].map(d=>`<div class="pill ${state.difficulty===d?"active":""}" data-d="${d}">${d.toUpperCase()}</div>`).join("")}
            </div>
          </div>

          <button class="btn cyan" id="startBtn">Start Practice</button>
          <button class="btn" id="backBtn">Back to Lobby</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("exitMini").onclick=()=>{
    if (confirm("Exit practice and go back to lobby?")) location.href="index.html";
  };

  document.querySelectorAll("[data-b]").forEach(el=>{
    el.onclick=()=>{ state.bots=Number(el.dataset.b); requestRender(); };
  });
  document.querySelectorAll("[data-d]").forEach(el=>{
    el.onclick=()=>{ state.difficulty=el.dataset.d; requestRender(); };
  });

  document.getElementById("startBtn").onclick=()=>{
    unlockAudio();
    startGame(name);
  };
  document.getElementById("backBtn").onclick=()=>location.href="index.html";
}

function startGame(youName){
  state.deck = shuffle(makeDeck());
  state.unwanted = [];
  state.selected.clear();
  state.selectedMeld = null;
  state.peekIndex = 0;

  state.players = [
    {id:0, name: youName || "You", isBot:false, hand:[], melds:[], hasLaidMeldThisRound:false},
    ...botNames(state.bots).map((n,i)=>({id:i+1, name:n, isBot:true, hand:[], melds:[], hasLaidMeldThisRound:false}))
  ];

  state.dealer = Math.floor(Math.random()*state.players.length);
  const left = (state.dealer+1)%state.players.length;

  // Deal 7 each
  for (let i=0;i<7;i++){
    for (const p of state.players) p.hand.push(state.deck.pop());
  }
  // Left of dealer gets 8
  state.players[left].hand.push(state.deck.pop());

  // Start unwanted
  state.unwanted.push(state.deck.pop());

  beginTurn(left);
  state.screen="game";
  requestRender();
  maybeBot();
}

function beginTurn(i){
  state.turn=i;
  state.phase="draw";
  state.selected.clear();
  state.selectedMeld = null;
  state.peekIndex = 0;
  state.warned30=false;
  state.warned15=false;
  state.turnEndsAt = Date.now()+60000;
}

function isYourTurn(){ return state.turn===0; }
function currentPlayer(){ return state.players[state.turn]; }

function cardFaceHtml(c, extraClass=""){
  const colorClass = isRed(c.s) ? "red" : "black";
  return `
    <div class="card ${colorClass} ${extraClass}" data-id="${c.id}">
      <div class="corner tl"><div>${c.r}</div><div>${c.s}</div></div>
      <div class="pip">${c.s}</div>
      <div class="corner br"><div>${c.r}</div><div>${c.s}</div></div>
    </div>
  `;
}

function renderMeld(meld){
  return meld.map(c=>`
    <div class="card ${isRed(c.s) ? "red" : "black"}">
      <div class="corner tl"><div>${c.r}</div><div>${c.s}</div></div>
      <div class="pip">${c.s}</div>
      <div class="corner br"><div>${c.r}</div><div>${c.s}</div></div>
    </div>
  `).join("");
}

function visibleUnwanted(){
  // show last 16; TOP card is index 0
  return state.unwanted.slice(-16).reverse();
}
function renderGame(){
  const me = state.players[0];

  const sec = Math.ceil(Math.max(0, state.turnEndsAt - Date.now())/1000);
  const danger = sec<=30 ? "danger" : "";

  const vis = visibleUnwanted();
  const maxDepth = Math.max(0, vis.length-1);
  const depth = Math.min(state.peekIndex, maxDepth);
  const peek = vis.length ? vis[depth] : null;

  const turnName = currentPlayer().name;
  const isMe = isYourTurn();

  // Opponent seats (highlight whose turn)
  const seatsHtml = state.players.slice(1).map(p=>`
    <div class="seatBox ${p.id===state.turn ? "activeTurn":""}">
      <b>${p.name}</b> <span class="small">${p.id===state.turn ? "• TURN" : ""}</span>
      <div class="small">Cards left: ${p.hand.length}</div>
      <div class="small">${p.hasLaidMeldThisRound ? "Can add to melds ✅" : "Must lay 1 meld first ⛔️"}</div>
    </div>
  `).join("");

  // My melds (clickable groups to select for adding)
  const myMeldsHtml = me.melds.length
    ? me.melds.map((m, mid)=>`
        <div class="meldGroup">
          <div class="small">Meld ${mid+1}</div>
          <div class="meldTap ${state.selectedMeld && state.selectedMeld.pid===0 && state.selectedMeld.mid===mid ? "active":""}"
               data-pid="0" data-mid="${mid}">
            ${renderMeld(m)}
          </div>
        </div>
      `).join("")
    : `<div class="small" style="margin-top:8px;">None yet</div>`;

  // Opponents melds (clickable, only show once they exist)
  const oppMeldsHtml = state.players.slice(1).map(p=>{
    if (!p.melds.length){
      return `
        <div class="seatBox ${p.id===state.turn ? "activeTurn":""}">
          <b>${p.name}</b>
          <div class="small">No melds yet</div>
        </div>
      `;
    }
    return `
      <div class="seatBox ${p.id===state.turn ? "activeTurn":""}">
        <b>${p.name}</b>
        <div class="small">Melds (tap to select)</div>
        ${p.melds.map((m, mid)=>`
          <div class="meldGroup">
            <div class="meldTap ${state.selectedMeld && state.selectedMeld.pid===p.id && state.selectedMeld.mid===mid ? "active":""}"
                 data-pid="${p.id}" data-mid="${mid}">
              ${renderMeld(m)}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }).join("");

  // Big turn banner
  const bannerText = isMe ? "YOUR TURN" : `${turnName.toUpperCase()}'S TURN`;
  const bannerHint = isMe
    ? (state.phase==="draw" ? "Draw from Deck or Unwanted" : "Lay / Add, then Discard 1 to end turn")
    : "Waiting for other player…";

  // Allowed to add to melds this round?
  const canAddThisRound = me.hasLaidMeldThisRound;

  app.innerHTML = `
    <div class="safe">
      <div class="shell">
        <div class="hdr">
          <div class="brand">
            <div class="title">Cousins</div>
            <div class="subtitle">Rummy Room</div>
            <div class="underline"></div>
          </div>
          <div class="exitMini" id="exitMini">Exit</div>
        </div>

        <div class="turnBanner">
          <div>
            <div>${bannerText}</div>
            <div class="muted">${bannerHint}</div>
          </div>
          <div id="timerText" class="${danger}">${sec}s</div>
        </div>

        <div class="panel gameArea">
          <div class="seatRow">
            ${seatsHtml}
          </div>

          <div class="centerRow">
            <div class="pileBox ${state.turn===0 ? "activeTurn":""}">
              <b>Deck</b>
              <div class="small">${state.deck.length} left</div>
              <div class="deckStack" id="deckTap" title="Tap to draw">
                <div class="back"></div>
                <div class="back"></div>
                <div class="back"></div>
                <div class="label">TAP</div>
              </div>
              <div class="hint">Tap the deck to draw 1</div>
            </div>

            <div class="pileBox">
              <b>Unwanted</b>
              <div class="small">${state.unwanted.length} cards</div>

              <div class="small" style="margin-top:8px;">
                Selected: ${peek ? cardLabel(peek) : "—"} ${depth?`(deep +${depth})`:"(top)"}
              </div>

              <div class="peekWrap">
                <div class="peekStrip" id="unwantedScroll">
                  ${
                    vis.length
                      ? vis.map((c,i)=>`
                          <div class="peekCard ${i===depth ? "active":""}" data-depth="${i}">
                            ${cardFaceHtml(c)}
                          </div>
                        `).join("")
                      : `<div class="small">Empty</div>`
                  }
                </div>
              </div>

              <div style="height:10px"></div>
              <div class="btnRow">
                <button class="btn cyan" id="takeTopBtn"
                  ${(!isMe || state.phase!=="draw" || !peek || depth!==0)?"disabled":""}>
                  Take Top
                </button>
                <button class="btn" id="takeAllBtn"
                  ${(!isMe || state.phase!=="draw" || !peek)?"disabled":""}>
                  Take All
                </button>
              </div>

              ${(depth!==0 && peek) ? `<div class="note" style="margin-top:8px;">Deeper card selected — you must Take All.</div>` : ``}
            </div>
          </div>

          <div class="seatBox">
            <b>Your melds</b>
            <div class="small">
              ${me.hasLaidMeldThisRound ? "Add-to-meld is unlocked ✅" : "You must lay at least 1 meld this round to unlock add-to-meld ⛔️"}
            </div>
            ${myMeldsHtml}
          </div>

          ${oppMeldsHtml}

          <div class="seatBox ${isMe ? "activeTurn":""}">
            <div class="row">
              <div>
                <b>Your hand</b>
                <div class="small">Phase: ${state.phase.toUpperCase()}</div>
              </div>
              <div class="small">${state.selectedMeld ? `Selected meld: P${state.selectedMeld.pid} / #${state.selectedMeld.mid+1}` : "No meld selected"}</div>
            </div>

            <div style="height:10px"></div>
            <div class="handRow" id="hand">
              ${me.hand.map(c=>cardFaceHtml(c, state.selected.has(c.id) ? "sel" : "")).join("")}
            </div>

            <div style="height:10px"></div>
            <div class="btnRow">
              <button class="btn cyan" id="layBtn" ${(!isMe || state.phase==="draw")?"disabled":""}>Lay Meld</button>
              <button class="btn" id="addBtn"
                ${(!isMe || state.phase==="draw" || !canAddThisRound || !state.selectedMeld)?"disabled":""}>
                Add Selected
              </button>
            </div>

            <div style="height:10px"></div>
            <div class="btnRow">
              <button class="btn" id="discardBtn" ${(!isMe || state.phase!=="discard")?"disabled":""}>Discard (1)</button>
              <button class="btn" id="clearSelBtn" ${(!isMe)?"disabled":""}>Clear</button>
            </div>

            <div class="note" style="margin-top:8px;">
              Turn flow: Draw → (Lay / Add) → Discard 1.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Restore hand scroll position (prevents snapping back)
  const handEl = document.getElementById("hand");
  if (handEl) handEl.scrollLeft = state.handScrollLeft || 0;

  // Exit moved + confirm
  document.getElementById("exitMini").onclick=()=>{
    if (confirm("Exit practice and go back to lobby?")) location.href="index.html";
  };

  // Hand selection
  document.querySelectorAll(".card[data-id]").forEach(el=>{
    el.onclick=()=>{
      if (!isYourTurn()) return;
      if (state.phase==="draw") return; // cannot select before drawing
      const id = el.dataset.id;
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      requestRender();
    };
  });

  // Tap meld to select destination for Add Selected
  document.querySelectorAll(".meldTap[data-pid][data-mid]").forEach(el=>{
    el.onclick=()=>{
      if (!isYourTurn()) return;
      const pid = Number(el.dataset.pid);
      const mid = Number(el.dataset.mid);
      state.selectedMeld = {pid, mid};
      requestRender();
    };
  });

  // Deck tap-to-draw
  document.getElementById("deckTap")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="draw") return;
    drawFromDeck(0);
    state.phase="discard";
    requestRender();
  });

  // Unwanted take
  document.getElementById("takeTopBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="draw") return;
    if (state.peekIndex !== 0) return;
    takeTop(0);
    state.phase="discard";
    requestRender();
  });
  document.getElementById("takeAllBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="draw") return;
    takeAll(0);
    state.phase="discard";
    requestRender();
  });

  // Unwanted: tap to select
  const strip = document.getElementById("unwantedScroll");
  if (strip){
    strip.querySelectorAll("[data-depth]").forEach(el=>{
      el.onclick = () => {
        if (!isYourTurn() || state.phase !== "draw") return;
        state.peekIndex = Number(el.dataset.depth || "0");
        requestRender();
      };
    });

    // Unwanted: scroll-select nearest to center (debounced)
    let t = null;
    strip.addEventListener("scroll", () => {
      if (!isYourTurn() || state.phase !== "draw") return;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        const rect = strip.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;

        let bestDepth = 0;
        let bestDist = Infinity;

        strip.querySelectorAll("[data-depth]").forEach(el => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const dist = Math.abs(cx - centerX);
          if (dist < bestDist) {
            bestDist = dist;
            bestDepth = Number(el.dataset.depth || "0");
          }
        });

        if (bestDepth !== state.peekIndex) {
          state.peekIndex = bestDepth;
          requestRender();
        }
      }, 80);
    }, { passive:true });
  }

  // Buttons
  document.getElementById("clearSelBtn")?.addEventListener("click", ()=>{
    state.selected.clear();
    requestRender();
  });

  document.getElementById("layBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase==="draw") return;
    layMeldHuman();
  });

  document.getElementById("addBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase==="draw") return;
    addToMeldHuman();
  });

  document.getElementById("discardBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="discard") return;
    discardOneHuman();
  });
}

// ---- draw/take helpers ----
function drawFromDeck(playerIndex){
  if (!state.deck.length) state.deck = shuffle(makeDeck());
  state.players[playerIndex].hand.push(state.deck.pop());
}
function takeTop(playerIndex){
  const top = state.unwanted.pop();
  if (!top) return;
  state.players[playerIndex].hand.push(top);
  state.peekIndex = 0;
}
function takeAll(playerIndex){
  if (!state.unwanted.length) return;
  while(state.unwanted.length){
    state.players[playerIndex].hand.push(state.unwanted.shift());
  }
  state.peekIndex = 0;
}
// ---- Human actions ----
function layMeldHuman(){
  const me = state.players[0];
  const cards = me.hand.filter(c=>state.selected.has(c.id));

  const v = validateMeld(cards);
  if (!v.ok){ alert(v.why); return; }
  if (v.kind==="set" && cards.length>4){ alert("Sets are max 4."); return; }

  // remove from hand
  const rm = new Set(cards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!rm.has(c.id));

  // add meld
  me.melds.push(cards.slice());

  // unlock add-to-meld for the rest of the ROUND
  me.hasLaidMeldThisRound = true;

  state.selected.clear();
  // still must discard to end turn
  state.phase = "discard";
  requestRender();
}

function addToMeldHuman(){
  const me = state.players[0];
  if (!me.hasLaidMeldThisRound){
    alert("You must lay at least 1 meld first in this ROUND before adding to melds.");
    return;
  }
  if (!state.selectedMeld){
    alert("Tap a meld first to select where to add.");
    return;
  }

  const addCards = me.hand.filter(c=>state.selected.has(c.id));
  if (!addCards.length){
    alert("Select at least 1 card from your hand to add.");
    return;
  }

  const {pid, mid} = state.selectedMeld;
  const targetPlayer = state.players.find(p=>p.id===pid);
  if (!targetPlayer || !targetPlayer.melds[mid]){
    alert("That meld no longer exists.");
    state.selectedMeld = null;
    requestRender();
    return;
  }

  const meld = targetPlayer.melds[mid];
  const res = canAddToMeld(meld, addCards);
  if (!res.ok){
    alert("Those cards can't be added to that meld.");
    return;
  }

  // update meld + remove cards from hand
  targetPlayer.melds[mid] = res.newMeld;
  const rm = new Set(addCards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!rm.has(c.id));

  state.selected.clear();
  // you can keep adding, but still must discard to end
  state.phase = "discard";
  requestRender();
}

function discardOneHuman(){
  const me = state.players[0];
  const chosen = me.hand.filter(c=>state.selected.has(c.id));
  if (chosen.length!==1){
    alert("Select exactly 1 card to discard.");
    return;
  }
  const c = chosen[0];
  me.hand = me.hand.filter(x=>x.id!==c.id);
  state.unwanted.push(c);

  state.selected.clear();
  state.selectedMeld = null;

  // win check
  if (me.hand.length===0){
    alert("You went out! Restarting practice hand.");
    restartHand();
    return;
  }
  endTurn();
}

function restartHand(){
  // new round/hand: reset per-round flags
  const youName = state.players[0]?.name || (localStorage.getItem("crr_name")||"You");
  startGame(youName);
}

function endTurn(){
  const next = (state.turn+1)%state.players.length;
  beginTurn(next);
  requestRender();
  maybeBot();
}

// ---- Bots ----
function skill(){
  if (state.difficulty==="easy") return 0.45;
  if (state.difficulty==="mid") return 0.65;
  if (state.difficulty==="pro") return 0.82;
  return 0.90; // GOAT
}

function maybeBot(){
  const p = currentPlayer();
  if (!p.isBot) return;
  setTimeout(()=>botTurn(), 520);
}

function botTurn(){
  const p = currentPlayer();
  if (!p || !p.isBot) return;

  // 1) Draw decision
  const s = skill();
  const top = state.unwanted[state.unwanted.length-1] || null;

  if (top && Math.random()<s && topHelps(p.hand, top)){
    p.hand.push(state.unwanted.pop());
  } else {
    if (!state.deck.length) state.deck = shuffle(makeDeck());
    p.hand.push(state.deck.pop());
  }

  // After drawing, bot goes to discard phase
  state.phase = "discard";

  // 2) Try to lay a meld sometimes
  const triesLay = state.difficulty==="easy" ? 0 : (state.difficulty==="mid" ? 1 : 2);
  for (let t=0;t<triesLay;t++){
    const meld = bestMeld(p.hand);
    if (!meld) break;
    p.melds.push(meld);
    const rm = new Set(meld.map(c=>c.id));
    p.hand = p.hand.filter(c=>!rm.has(c.id));
    p.hasLaidMeldThisRound = true; // unlock add for round
  }

  // 3) If unlocked, sometimes add onto any existing meld
  const triesAdd = p.hasLaidMeldThisRound ? (state.difficulty==="pro" || state.difficulty==="goat" ? 2 : 1) : 0;
  for (let t=0;t<triesAdd;t++){
    const addMove = bestAddMove(p);
    if (!addMove) break;
    const {pid, mid, cards} = addMove;
    const tp = state.players.find(x=>x.id===pid);
    tp.melds[mid] = canAddToMeld(tp.melds[mid], cards).newMeld;
    const rm = new Set(cards.map(c=>c.id));
    p.hand = p.hand.filter(c=>!rm.has(c.id));
  }

  // 4) Discard
  const disc = chooseDiscard(p.hand);
  p.hand = p.hand.filter(c=>c.id!==disc.id);
  state.unwanted.push(disc);

  // win check
  if (p.hand.length===0){
    alert(`${p.name} went out! Restarting practice hand.`);
    restartHand();
    return;
  }

  endTurn();
}

function topHelps(hand, card){
  const sameRank = hand.filter(c=>c.r===card.r).length;
  if (sameRank>=2) return true;
  const adj = hand.some(c=>c.s===card.s && Math.abs(rankNum(c.r)-rankNum(card.r))===1);
  return adj;
}

function bestMeld(hand){
  // sets first
  const byRank = {};
  for (const c of hand){
    byRank[c.r] = byRank[c.r] || [];
    byRank[c.r].push(c);
  }
  for (const r in byRank){
    const g = byRank[r];
    if (g.length>=3) return g.slice(0, Math.min(4, g.length));
  }

  // runs (simple)
  for (const s of SUITS){
    const suitCards = hand.filter(c=>c.s===s).sort((a,b)=>rankNum(a.r)-rankNum(b.r));
    if (suitCards.length<3) continue;

    let best=[], cur=[suitCards[0]];
    for (let i=1;i<suitCards.length;i++){
      const prev = rankNum(suitCards[i-1].r);
      const now  = rankNum(suitCards[i].r);
      if (now===prev+1) cur.push(suitCards[i]);
      else { if (cur.length>best.length) best=cur; cur=[suitCards[i]]; }
    }
    if (cur.length>best.length) best=cur;
    if (best.length>=3) return best;
  }
  return null;
}

function bestAddMove(bot){
  // Find any meld on table and see if bot can add 1-2 cards
  const s = skill();
  const maxAdd = (state.difficulty==="goat" ? 3 : state.difficulty==="pro" ? 2 : 1);

  // collect meld targets
  const targets = [];
  for (const p of state.players){
    for (let mid=0; mid<p.melds.length; mid++){
      targets.push({pid:p.id, mid});
    }
  }
  if (!targets.length) return null;

  // try random-ish targets for imperfection
  for (let attempt=0; attempt<8; attempt++){
    const tgt = targets[Math.floor(Math.random()*targets.length)];
    const tp = state.players.find(x=>x.id===tgt.pid);
    const meld = tp.melds[tgt.mid];

    // choose up to maxAdd cards from bot hand that might fit
    const hand = bot.hand.slice();
    // shuffle for variety
    for (let i=hand.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [hand[i],hand[j]]=[hand[j],hand[i]];
    }

    const chosen = [];
    for (const c of hand){
      if (chosen.length>=maxAdd) break;
      const res = canAddToMeld(meld, chosen.concat([c]));
      if (res.ok){
        chosen.push(c);
        // on lower skills, stop early
        if (Math.random() > s) break;
      }
    }

    if (chosen.length){
      return {pid:tgt.pid, mid:tgt.mid, cards:chosen};
    }
  }

  return null;
}

function chooseDiscard(hand){
  if (hand.length===1) return hand[0];

  const s = skill();
  if (state.difficulty==="easy" && Math.random()>(s)){
    return hand[Math.floor(Math.random()*hand.length)];
  }

  let worst = hand[0];
  let worstScore = Infinity;
  for (const c of hand){
    let score=0;
    for (const h of hand){
      if (h.id===c.id) continue;
      if (h.r===c.r) score+=2;
      if (h.s===c.s && Math.abs(rankNum(h.r)-rankNum(c.r))===1) score+=1;
    }
    score += (1-s) * Math.random()*3;
    if (score < worstScore){ worstScore = score; worst = c; }
  }
  return worst;
}

// ---- Timer (no constant full re-render) ----
setInterval(()=>{
  if (state.screen!=="game") return;

  const sec = Math.ceil(Math.max(0, state.turnEndsAt-Date.now())/1000);
  const timer = document.getElementById("timerText");
  if (timer){
    timer.textContent = `${sec}s`;
    if (sec<=30) timer.classList.add("danger");
    else timer.classList.remove("danger");
  }

  if (!state.warned30 && sec<=30){ state.warned30=true; chime(); }
  if (!state.warned15 && sec<=15){ state.warned15=true; doubleChime(); }

  if (sec<=0){
    const p = currentPlayer();
    if (!p) return;

    // timeout: if in draw phase, draw from deck
    if (state.phase==="draw"){
      if (!state.deck.length) state.deck = shuffle(makeDeck());
      p.hand.push(state.deck.pop());
    }

    // then discard random
    if (p.hand.length){
      const c = p.hand[Math.floor(Math.random()*p.hand.length)];
      p.hand = p.hand.filter(x=>x.id!==c.id);
      state.unwanted.push(c);
    }

    endTurn();
  }

  if (state.uiNeedsRender) render();
}, 250);

// boot
render();