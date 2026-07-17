/* ============================================================
   supremRe — MRE Hype Drop
   All payment methods are frontend theater; every path converges
   on POST /claim. Nothing is reserved until that call lands.
   ============================================================ */

const CFG = window.SUPREMRE_CONFIG;
const API = CFG.API_BASE.replace(/\/$/, '');
const $app = document.getElementById('app');

const LS = {
  name: 'supremre_operative',
  card: 'supremre_card_fields',
  ballpay: 'supremre_ballpay_done',
  queue: 'supremre_queue_start',
};

const state = {
  me: localStorage.getItem(LS.name) || null,
  mres: [],
  dropTime: null,     // ms epoch
  clockOffset: 0,     // serverNow - clientNow
  view: null,         // current view name; poll only rerenders 'grid'
  itemId: null,       // item being checked out
  pollTimer: null,
  tickTimer: null,
};

const serverNow = () => Date.now() + state.clockOffset;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const TIER_LABEL = { S: 'S-TIER', A: 'A-TIER', B: 'B-TIER', cursed: 'CURSED' };

// Product-page copy, keyed by menu_no. Terse, catalog-voice, Courier-set.
const DESC = {
  1: 'The grail. Beef chili with macaroni in a pouch that trades above retail behind every mess tent on earth. Flameless ration heater included. You will not be the only one deploying for this.',
  2: 'Beef ravioli in meat sauce. The people’s champ. Reliable, beloved, gone in seconds.',
  4: 'Spaghetti with beef and sauce. A known quantity. Nobody brags about it, nobody returns it.',
  8: 'Meatballs in marinara. Solid mid. Ships with crackers and a cheese spread of unverifiable origin.',
  11: 'Cheese tortellini. Meatless but honest. The jalapeño cheese spread carries the whole kit.',
  14: 'Pepper jack beef patty. A hamburger, legally speaking. Bread may arrive as a concept.',
  21: 'Vegetarian omelette. The infamous one. Egg-adjacent loaf, feared service-wide. All sales final applies here with unusual force.',
};

// The CSS-drawn "product photo": a tan MRE pouch on white.
// size: '' (grid tile) | 'big' (product page) | 'thumb' (checkout row)
function pouchHTML(m, size = '') {
  return `
    <div class="ph ${size}">
      <div class="pouch ${m.tier === 'cursed' ? 'cursed' : ''}">
        <div class="p-band">U.S. GOVERNMENT PROPERTY</div>
        <div class="p-legal">MEAL, READY-TO-EAT</div>
        <div class="p-menu">MENU NO. ${m.menu_no}</div>
        <div class="mre-name">${esc(m.name)}</div>
        <div class="p-nsn">NSN ${esc(m.nsn)}</div>
      </div>
    </div>`;
}

// Shop chrome: small box logo, tiny lowercase nav. active: 'shop' | 'manifest'
function pageHeader(active = 'shop') {
  return `
    <header class="sup-header">
      <div class="boxlogo small">supremRe<span class="tm">™</span></div>
      <nav class="sup-nav">
        <a id="nav-shop" class="${active === 'shop' ? 'active' : ''}">shop</a>
        <a id="nav-manifest" class="${active === 'manifest' ? 'active' : ''}">manifest</a>
        <span class="op">${esc(state.me)}</span>
      </nav>
    </header>`;
}

function wireHeader() {
  const shop = document.getElementById('nav-shop');
  const manifest = document.getElementById('nav-manifest');
  if (shop) shop.onclick = showGrid;
  if (manifest) manifest.onclick = showManifest;
}
const item = (id) => state.mres.find((m) => m.id === id);
const myClaim = () => state.mres.find((m) => m.claimed_by === state.me);
const allClaimed = () => state.mres.length > 0 && state.mres.every((m) => m.claimed);

// ---------------- API ----------------
async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return res.json();
}

async function refreshStock() {
  state.mres = await apiGet('/mres');
}

// The single mutating call. Every payment flow ends here.
async function fireClaim(mreId) {
  let res;
  try {
    res = await fetch(`${API}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mre_id: mreId, user: state.me }),
    });
  } catch {
    return renderTransmissionLost(mreId);
  }
  const body = await res.json().catch(() => ({}));
  await refreshStock().catch(() => {});

  if (res.ok) return renderSecured(body.item);
  if (body.reason === 'taken') return renderTooSlow(mreId, body.winner);
  if (body.reason === 'already_have') return renderAlreadyHave(body.menu);
  if (body.reason === 'not_live') { syncConfig().then(showCountdown); return; }
  renderTransmissionLost(mreId);
}

async function syncConfig() {
  const cfg = await apiGet('/config');
  state.clockOffset = new Date(cfg.server_now).getTime() - Date.now();
  state.dropTime = cfg.drop_time ? new Date(cfg.drop_time).getTime() : 0;
}

// ---------------- polling ----------------
function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(async () => {
    try { await refreshStock(); } catch { return; }
    // Only the grid rerenders on poll — never clobber a form mid-checkout.
    if (state.view === 'grid') {
      allClaimed() ? showManifest() : renderGrid();
    }
  }, CFG.POLL_MS);
}

function setView(name, bodyTheme) {
  state.view = name;
  if (bodyTheme) document.body.className = bodyTheme;
  clearInterval(state.tickTimer);
  state.tickTimer = null;
  window.scrollTo(0, 0);
}

// ================= GATE (pick your name) =================
function showGate(msg = '') {
  setView('gate', 'theme-drab');
  $app.innerHTML = `
    <div class="briefing">
      <div class="classified mono">// RESTRICTED // RATION OPS //</div>
      <div class="boxlogo">supremRe<span class="tm">™</span></div>
      <h1 class="stencil">Operative Check-In</h1>
      <p class="sub">state your name for the manifest</p>
      <input id="namein" class="gate-input" maxlength="20" placeholder="E.G. DAVE" autocomplete="off">
      <div class="notice">${esc(msg)}</div>
      <button id="enlist" class="btn btn-red btn-block">ENLIST</button>
      <p class="mono" style="margin-top:14px;font-size:.72rem;opacity:.7">
        no login. no password. your name is your claim key. don't be weird about it.
      </p>
    </div>`;
  const input = document.getElementById('namein');
  input.focus();
  const submit = async () => {
    const name = input.value.trim().toUpperCase().replace(/\s+/g, ' ');
    if (name.length < 2) return showGate('CALLSIGN TOO SHORT, SOLDIER.');
    try { await refreshStock(); } catch {}
    // Name is the claim key — reject one that already holds a kit.
    if (state.mres.some((m) => m.claimed_by === name)) {
      return showGate(`OPERATIVE "${name}" ALREADY HOLDS A KIT. PICK ANOTHER NAME.`);
    }
    state.me = name;
    localStorage.setItem(LS.name, name);
    route();
  };
  document.getElementById('enlist').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ================= COUNTDOWN (cold open) =================
function queueStart() {
  let q = Number(localStorage.getItem(LS.queue));
  if (!q) {
    q = CFG.FAKE_QUEUE_MIN + Math.floor(Math.random() * (CFG.FAKE_QUEUE_MAX - CFG.FAKE_QUEUE_MIN));
    localStorage.setItem(LS.queue, String(q));
  }
  return q;
}

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function showCountdown() {
  setView('countdown', 'theme-drab');
  $app.innerHTML = `
    <div class="briefing">
      <div class="classified mono">// OPERATION: CHOW CALL // EYES ONLY //</div>
      <div class="boxlogo">supremRe<span class="tm">™</span></div>
      <h1 class="stencil">Ration Drop Imminent</h1>
      <p class="sub">7 meals. 7 operatives. 0 mercy.</p>
      <div id="clock" class="clock">--:--</div>
      <p class="queuepos">YOU ARE <b id="qpos">#—</b> IN LINE OF ~${CFG.FAKE_QUEUE_TOTAL.toLocaleString()}</p>
      <div class="rules">
        <h3>RULES OF THE DROP</h3>
        <li>ONE (1) MRE PER OPERATIVE.</li>
        <li>FIRST COME, FIRST SERVE. PAYMENT COMPLETION IS THE ONLY LOCK.</li>
        <li>IF YOUR MENU IS SECURED BY ANOTHER OPERATIVE, DEPLOY FOR ANOTHER.</li>
        <li>ALL SALES FINAL. ESPECIALLY THE OMELETTE.</li>
      </div>
      <p class="mono" style="margin-top:14px;font-size:.72rem;opacity:.7">logged in as ${esc(state.me)}</p>
    </div>`;

  const total = Math.max(state.dropTime - serverNow(), 1);
  const q0 = queueStart();
  let ticks = 0;
  const tick = () => {
    // Re-sync drop_time every ~5s so a rescheduled drop reaches waiting clients.
    if (++ticks % 20 === 0) syncConfig().catch(() => {});
    const left = state.dropTime - serverNow();
    if (left <= 0) {
      clearInterval(state.tickTimer);
      state.tickTimer = null;
      return goLive();
    }
    document.getElementById('clock').textContent = fmtClock(left);
    // Queue "advances" toward the front as T-0 approaches, with jitter.
    const pos = Math.max(1, Math.floor(q0 * (left / total)) - Math.floor(Math.random() * 25));
    document.getElementById('qpos').textContent = `#${pos.toLocaleString()}`;
  };
  tick();
  state.tickTimer = setInterval(tick, 250);
}

function goLive() {
  // The drab->red snap is a hype beat of its own.
  const flash = document.createElement('div');
  flash.className = 'redflash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 950);
  startPolling();
  refreshStock().then(() => (allClaimed() ? showManifest() : showGrid())).catch(showGrid);
}

// ================= DROP GRID =================
function showGrid() {
  setView('grid', 'theme-red');
  startPolling();
  renderGrid();
}

function renderGrid() {
  const mine = myClaim();
  // Supreme shop grid: photos only. No captions, no borders, no tier badges.
  const tiles = state.mres.map((m) => {
    const sold = m.claimed;
    return `
      <button class="tile ${sold ? 'sold' : ''}" data-id="${m.id}"
              ${sold || mine ? 'disabled' : ''}
              ${sold ? `title="secured by ${esc(m.claimed_by)}"` : ''}>
        ${pouchHTML(m)}
        ${sold ? '<div class="soldout"><span>sold out</span></div>' : ''}
      </button>`;
  }).join('');

  $app.innerHTML = `
    ${pageHeader('shop')}
    ${mine
      ? `<div class="mystatus">KIT SECURED: <b>MENU NO. ${mine.menu_no} — ${esc(mine.name)}</b>. ONE PER OPERATIVE. ENJOY THE SHOW.</div>`
      : `<div class="mystatus">DROP IS LIVE. PAYMENT COMPLETION IS THE ONLY LOCK — <b>MOVE.</b></div>`}
    <div class="grid">${tiles}</div>`;
  wireHeader();

  if (!mine) {
    $app.querySelectorAll('.tile:not(.sold)').forEach((t) => {
      t.onclick = () => showPaySelect(Number(t.dataset.id));
    });
  }
}

// ================= PAYMENT SELECT =================
function checkoutHeader(m) {
  return `
    ${pageHeader('shop')}
    <div class="checkout-item">
      ${pouchHTML(m, 'thumb')}
      <div>
        <div class="ci-name">${esc(m.name)}</div>
        <div class="ci-meta">menu no. ${m.menu_no} / ${TIER_LABEL[m.tier] ?? m.tier} / nsn ${esc(m.nsn)}</div>
      </div>
    </div>`;
}

// Payment select, laid out as a Supreme product page:
// photo left; name / style / description / price / buy buttons right.
function showPaySelect(id, notice = '') {
  const m = item(id);
  if (!m || m.claimed) return showGrid();
  state.itemId = id;
  setView('payselect', 'theme-red');
  const bpDone = localStorage.getItem(LS.ballpay) === '1';
  $app.innerHTML = `
    ${pageHeader('shop')}
    <div class="product">
      ${pouchHTML(m, 'big')}
      <div class="pd">
        ${notice ? `<div class="pp-loss">${esc(notice)}</div>` : ''}
        <h1 class="pd-name">${esc(m.name)}</h1>
        <p class="pd-style">Menu No. ${m.menu_no} / ${TIER_LABEL[m.tier] ?? m.tier}</p>
        <p class="pd-desc">${esc(DESC[m.menu_no] || 'Meal, Ready-to-Eat. Individual. Contents classified.')}</p>
        <p class="pd-price">$0.00 <small>&mdash; 1 per operative. item is not held while you pay.</small></p>
        <div class="paydoors">
          <button class="paydoor" data-pay="ballpay">
            <span class="pd-buy">ball pay</span>
            <span class="pd-tag">${bpDone ? 'verification on file. instant.' : 'upload payment verification photo. if you dare.'}</span>
          </button>
          <button class="paydoor" data-pay="card">
            <span class="pd-buy">card</span>
            <span class="pd-tag">standard secure checkout. thorough. very thorough.</span>
          </button>
          <button class="paydoor" data-pay="playpal">
            <span class="pd-buy">playpal</span>
            <span class="pd-tag">pay in 1 spin of 1. ${Math.round(CFG.PLAYPAL_WIN_RATE * 100)}% approval odds.</span>
          </button>
        </div>
        <button class="backlink" id="back">back to shop</button>
      </div>
    </div>`;
  wireHeader();
  $app.querySelector('[data-pay="ballpay"]').onclick = () => showBallPay(id);
  $app.querySelector('[data-pay="card"]').onclick = () => showCardForm(id);
  $app.querySelector('[data-pay="playpal"]').onclick = () => showPlaypal(id);
  document.getElementById('back').onclick = showGrid;
}

// ================= BALL PAY (courage) =================
function showBallPay(id) {
  const m = item(id);
  setView('ballpay', 'theme-red');
  const bpDone = localStorage.getItem(LS.ballpay) === '1';
  $app.innerHTML = `
    ${checkoutHeader(m)}
    <div class="ballpay-drop">
      <div class="bp-big">BALL PAY&trade; PAYMENT VERIFICATION</div>
      ${bpDone
        ? `<p>Verification photo already on file.</p>
           <button id="bp-go" class="btn btn-red">pay with ball pay</button>`
        : `<p>Upload payment verification photo to proceed.</p>
           <label class="filelabel" for="bp-file">upload photo</label>
           <input type="file" id="bp-file" accept="image/*">`}
      <div class="bp-fine">
        photo is processed locally and never leaves your device.<br>
        what the photo must depict is left to operative discretion.<br>
        you know what it wants. do you have what it takes?
      </div>
    </div>
    <div id="bp-status" class="notice"></div>
    <button class="backlink" id="back">other payment methods</button>`;
  wireHeader();
  document.getElementById('back').onclick = () => showPaySelect(id);

  const verifyAndClaim = () => {
    const st = document.getElementById('bp-status');
    st.textContent = 'VERIFYING SUBJECT MATTER...';
    setTimeout(() => {
      localStorage.setItem(LS.ballpay, '1');
      st.textContent = 'VERIFIED. RESPECT. FIRING CLAIM...';
      fireClaim(id);
    }, CFG.BALLPAY_VERIFY_MS);
  };

  if (bpDone) {
    document.getElementById('bp-go').onclick = () => {
      document.getElementById('bp-status').textContent = 'FIRING CLAIM...';
      fireClaim(id);
    };
  } else {
    document.getElementById('bp-file').onchange = (e) => {
      if (e.target.files.length > 0) verifyAndClaim();
    };
  }
}

// ================= CARD FORM (patience) =================
// Format-checked, never content-checked — a speed bump, not a wall.
// Reading-required fields are the anti-autopilot layer.
const CARD_FIELDS = [
  { key: 'legal_name', label: '1. Full legal name', hint: 'as it appears on documents you have lost',
    validate: (v) => v.trim().length >= 2 ? null : 'REQUIRED.' },
  { key: 'phone', label: '2. Phone number', hint: '10 digits, no spaces',
    validate: (v) => /^\d{10}$/.test(v.trim()) ? null : 'EXACTLY 10 DIGITS.' },
  { key: 'address', label: '3. Home address', hint: 'where the MRE will be thrown',
    validate: (v) => v.trim().length >= 5 ? null : 'TOO SHORT TO BE AN ADDRESS.' },
  { key: 'license', label: '4. Driver’s license number', hint: '8 digits. any 8 digits. zeros are accepted.',
    validate: (v) => /^\d{8}$/.test(v.trim()) ? null : 'EXACTLY 8 DIGITS.' },
  { key: 'phone_rev', label: '5. Confirm phone number, backwards', hint: 'the reverse of field 2. read it again.',
    validate: (v, all) => v.trim() === (all.phone || '').trim().split('').reverse().join('') && v.trim() !== ''
      ? null : 'THAT IS NOT FIELD 2 BACKWARDS.' },
  { key: 'school', label: '6. Elementary school attended', hint: 'we will not verify. we will judge.',
    validate: (v) => v.trim() ? null : 'REQUIRED.' },
  { key: 'water', label: '7. Favorite water brand', hint: 'be honest',
    validate: (v) => !v.trim() ? 'REQUIRED.' : /dasani/i.test(v) ? 'BE SERIOUS.' : null },
  { key: 'teeth', label: '8. Number of teeth you currently have', hint: 'count if unsure. we can wait. others cannot.',
    validate: (v) => { const n = Number(v.trim()); return Number.isInteger(n) && n >= 0 && n <= 32 ? null : '0–32. HUMANS ONLY.'; } },
  { key: 'maiden_color', label: '9. Mother’s maiden name’s favorite color', hint: 'the color the name would like',
    validate: (v) => v.trim() ? null : 'REQUIRED.' },
  { key: 'ssn4', label: '10. Last 4 digits of a stranger’s SSN', hint: 'a STRANGER’S. do not incriminate yourself.',
    validate: (v) => /^\d{4}$/.test(v.trim()) ? null : 'EXACTLY 4 DIGITS.' },
];

const loadCard = () => { try { return JSON.parse(localStorage.getItem(LS.card)) || {}; } catch { return {}; } };

function showCardForm(id) {
  const m = item(id);
  setView('card', 'theme-red');
  const saved = loadCard();
  $app.innerHTML = `
    ${checkoutHeader(m)}
    <form class="cardform" id="cardform" novalidate>
      ${CARD_FIELDS.map((f) => `
        <div class="field">
          <label for="cf-${f.key}">${f.label}</label>
          <input id="cf-${f.key}" data-key="${f.key}" value="${esc(saved[f.key] || '')}" autocomplete="off">
          <div class="hint">${f.hint}</div>
          <div class="err" id="err-${f.key}"></div>
        </div>`).join('')}
      <button type="submit" class="btn btn-red btn-block">SUBMIT SECURE PAYMENT</button>
      <div class="notice" id="cf-status"></div>
    </form>
    <button class="backlink" id="back">other payment methods</button>`;
  wireHeader();
  document.getElementById('back').onclick = () => showPaySelect(id);

  const form = document.getElementById('cardform');
  // Persist every keystroke — the one-tap rebound depends on it.
  form.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', () => {
      const data = loadCard();
      data[inp.dataset.key] = inp.value;
      localStorage.setItem(LS.card, JSON.stringify(data));
    });
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    const values = {};
    form.querySelectorAll('input').forEach((inp) => { values[inp.dataset.key] = inp.value; });
    let firstBad = null;
    for (const f of CARD_FIELDS) {
      const err = f.validate(values[f.key] || '', values);
      const errEl = document.getElementById(`err-${f.key}`);
      const inpEl = document.getElementById(`cf-${f.key}`);
      errEl.textContent = err || '';
      inpEl.classList.toggle('bad', !!err);
      if (err && !firstBad) firstBad = inpEl;
    }
    if (firstBad) {
      firstBad.scrollIntoView({ block: 'center' });
      firstBad.focus();
      return;
    }
    document.getElementById('cf-status').textContent = 'PAYMENT ACCEPTED. FIRING CLAIM...';
    fireClaim(id);
  };
}

// ================= PLAYPAL (luck) =================
const REEL_SYMBOLS = ['★', '⚙', '✚', '❀', '⚡', '♟'];

function showPlaypal(id) {
  const m = item(id);
  setView('playpal', 'theme-red');
  $app.innerHTML = `
    ${checkoutHeader(m)}
    <div class="playpal">
      <div class="pp-title">Playpal&trade; &mdash; pay in 1 spin of 1</div>
      <div class="reels">
        <div class="reel" id="r0">?</div>
        <div class="reel" id="r1">?</div>
        <div class="reel" id="r2">?</div>
      </div>
      <button id="spin" class="btn btn-red">SPIN</button>
      <div class="pp-fine">
        approval odds: ${Math.round(CFG.PLAYPAL_WIN_RATE * 100)}%. no cooldown. no refunds. no financial advice.<br>
        a loss returns you to payment select. the clock does not stop for you.
      </div>
      <div class="notice" id="pp-status"></div>
    </div>
    <button class="backlink" id="back">other payment methods</button>`;
  wireHeader();
  document.getElementById('back').onclick = () => showPaySelect(id);

  document.getElementById('spin').onclick = () => {
    const btn = document.getElementById('spin');
    btn.disabled = true;
    const reels = [0, 1, 2].map((i) => document.getElementById(`r${i}`));
    reels.forEach((r) => r.classList.add('spinning'));
    const anim = setInterval(() => {
      reels.forEach((r) => {
        r.textContent = REEL_SYMBOLS[Math.floor(Math.random() * REEL_SYMBOLS.length)];
      });
    }, 80);

    // RNG on the critical path of a live race. Opt-in chaos.
    const win = Math.random() < CFG.PLAYPAL_WIN_RATE;
    setTimeout(() => {
      clearInterval(anim);
      reels.forEach((r) => r.classList.remove('spinning'));
      if (win) {
        reels.forEach((r) => { r.textContent = '★'; });
        document.getElementById('pp-status').textContent = 'LUCK VERIFIED. FIRING CLAIM...';
        fireClaim(id);
      } else {
        // A loss burns your lead and bounces you back to payment select.
        reels.forEach((r, i) => { r.textContent = REEL_SYMBOLS[(i * 2 + 1) % REEL_SYMBOLS.length]; });
        document.getElementById('pp-status').textContent = 'INSUFFICIENT LUCK.';
        setTimeout(() => showPaySelect(id, 'INSUFFICIENT LUCK'), 900);
      }
    }, CFG.PLAYPAL_SPIN_MS);
  };
}

// ================= RESULT SCREENS =================
function renderSecured(it) {
  setView('secured', 'theme-red');
  $app.innerHTML = `
    <div class="fullscreen fs-white">
      <div class="fs-eyebrow">TRANSACTION COMPLETE</div>
      <h1 style="color:var(--red)">SECURED</h1>
      <div class="fs-detail">MENU NO. ${it.menu_no} — ${esc(it.name)}</div>
      <div class="fs-op stencil">KIT ASSIGNED TO ${esc(it.claimed_by)}</div>
      <button id="go" class="btn btn-red">RETURN TO THE DROP</button>
    </div>`;
  document.getElementById('go').onclick = () => (allClaimed() ? showManifest() : showGrid());
}

// The group-chat moment. Must be fast to leave.
function renderTooSlow(mreId, winner) {
  const m = item(mreId);
  setView('tooslow', 'theme-red');
  $app.innerHTML = `
    <div class="fullscreen fs-red">
      <div class="fs-eyebrow">CONTACT LOST</div>
      <h1>TOO SLOW,<br>SOLDIER</h1>
      <div class="fs-detail">MENU NO. ${m ? m.menu_no : '?'} — SECURED BY ANOTHER OPERATIVE</div>
      <div class="fs-op">OPERATIVE: ${esc(winner || 'UNKNOWN')}</div>
      <button id="go" class="btn" style="background:#fff;color:var(--red)">RETURN TO THE DROP</button>
    </div>`;
  document.getElementById('go').onclick = () => (allClaimed() ? showManifest() : showGrid());
}

function renderAlreadyHave(menuNo) {
  setView('alreadyhave', 'theme-red');
  $app.innerHTML = `
    <div class="fullscreen fs-white">
      <div class="fs-eyebrow">SUPPLY DISCIPLINE</div>
      <h1>ONE PER<br>OPERATIVE</h1>
      <div class="fs-detail">YOU ALREADY HOLD MENU NO. ${esc(menuNo)}. STAND DOWN.</div>
      <button id="go" class="btn btn-red">RETURN TO THE DROP</button>
    </div>`;
  document.getElementById('go').onclick = () => (allClaimed() ? showManifest() : showGrid());
}

function renderTransmissionLost(mreId) {
  setView('neterror', 'theme-red');
  $app.innerHTML = `
    <div class="fullscreen fs-drab">
      <div class="fs-eyebrow">SIGNAL FAILURE</div>
      <h1>TRANSMISSION<br>LOST</h1>
      <div class="fs-detail">CLAIM DID NOT CONFIRM. THE ITEM MAY OR MAY NOT BE YOURS.</div>
      <button id="go" class="btn btn-red">RETRY CLAIM</button>
      <button id="back" class="backlink" style="color:var(--sand);margin-top:14px">check the grid instead</button>
    </div>`;
  document.getElementById('go').onclick = () => fireClaim(mreId);
  document.getElementById('back').onclick = showGrid;
}

// ================= MANIFEST =================
const CONDOLENCES = [
  'THE VOMELETTE CHOOSES ITS OWN. OUR CONDOLENCES,',
  'SOMEONE HAD TO. IT WAS ALWAYS GOING TO BE',
  'A GRATEFUL NATION MOURNS THE BREAKFAST OF',
];

async function showManifest() {
  setView('manifest', 'theme-red');
  let data;
  try { data = await apiGet('/manifest'); } catch { return showGrid(); }

  const rows = data.claimed.map((r) => `
    <div class="m-row ${r.tier === 'cursed' ? 'cursed-row' : ''}">
      <div class="m-op">${esc(r.claimed_by)}</div>
      <div class="m-item">
        <div class="nm">${esc(r.name)}</div>
        <div class="mn">MENU NO. ${r.menu_no} · NSN ${esc(r.nsn)}</div>
      </div>
      <span class="tierbadge tier-${r.tier}">${TIER_LABEL[r.tier] ?? r.tier}</span>
    </div>`).join('');

  const cursed = data.claimed.find((r) => r.tier === 'cursed');
  const condolence = cursed
    ? `<div class="condolence">${CONDOLENCES[cursed.menu_no % CONDOLENCES.length]} ${esc(cursed.claimed_by)}.</div>`
    : '';

  $app.innerHTML = `
    <div class="manifest">
      <div class="m-head">
        <div class="boxlogo small">supremRe<span class="tm">™</span></div>
        <h2>AFTER ACTION REPORT</h2>
      </div>
      <div class="m-sub">// RATION DROP MANIFEST // ${data.claimed.length}/${data.total} KITS ASSIGNED // ALL SALES FINAL //</div>
      ${rows || '<p class="mono">no kits assigned. the drop was a massacre in reverse.</p>'}
      ${condolence}
      <div class="m-foot">supremRe&trade; &middot; Meal, Ready-to-Eat &middot; unauthorized resale is a war crime</div>
    </div>
    ${data.complete ? '' : '<div style="text-align:center"><button class="backlink" id="back-shop">back to shop</button></div>'}`;
  const back = document.getElementById('back-shop');
  if (back) back.onclick = showGrid;
}

// ================= BOOT =================
async function route() {
  if (!state.me) return showGate();
  if (state.dropTime && serverNow() < state.dropTime) return showCountdown();
  startPolling();
  try { await refreshStock(); } catch {}
  allClaimed() ? showManifest() : showGrid();
}

(async function boot() {
  try {
    await syncConfig();
    await refreshStock();
  } catch {
    $app.innerHTML = `
      <div class="briefing">
        <div class="boxlogo">supremRe<span class="tm">™</span></div>
        <h1 class="stencil">Comms Down</h1>
        <p class="mono" style="margin-top:12px">cannot reach supply command (${esc(API)}).<br>check API_BASE in config.js, then refresh.</p>
      </div>`;
    return;
  }
  route();
})();
