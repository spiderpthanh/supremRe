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
  cardSaved: 'supremre_card_saved',
  ballpay: 'supremre_ballpay_done',
  queue: 'supremre_queue_start',
  cart: 'supremre_cart',
  adminSecret: 'supremre_admin_secret',
};

// Cart is single-item and purely client-side: nothing is held or reserved.
// The only lock in the game is still the /claim call at payment completion.
const getCart = () => Number(localStorage.getItem(LS.cart)) || null;
const setCart = (id) => (id ? localStorage.setItem(LS.cart, String(id)) : localStorage.removeItem(LS.cart));

const state = {
  me: localStorage.getItem(LS.name) || null,
  mres: [],
  dropTime: null,     // ms epoch
  clockOffset: 0,     // serverNow - clientNow
  playerCount: 7,     // drop ends after this many claims (server-configured)
  view: null,         // current view name; poll only rerenders 'grid'
  itemId: null,       // item being checked out
  pollTimer: null,
  tickTimer: null,
};

const serverNow = () => Date.now() + state.clockOffset;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Product-page copy, keyed by menu_no. Terse, catalog-voice, Courier-set.
const DESC = {
  1: 'Cheese tortellini in tomato sauce. Meatless but honest. The pasta course of the battlefield.',
  2: 'Mexican style rice and beans. A side dish that unionized and demanded entree status. Dependable.',
  3: 'Chicken burrito bowl. A burrito that gave up on structure. Assembly is your problem, operative.',
  4: 'Beef patty with jalapeño pepper jack. A cheeseburger, legally speaking. Bread may arrive as a concept.',
  5: 'Southwest beef and black beans. Bold. Regional. Directionally seasoned.',
  6: 'Italian sausage with peppers and onions in marinara. The street-fair classic, sealed at the factory for your protection.',
  7: 'Chicken chunks. White. Cooked. That is the full description on the pouch and we respect the honesty.',
  8: 'The grail. Pepperoni pizza in a pouch — decades of military food science bent toward one slice. You will not be the only one deploying for this.',
  9: 'Beef goulash. Old-world comfort by way of a defense contractor. Sturdy.',
  10: 'Pork sausage patty, maple flavored. Breakfast, allegedly. A puck of destiny. Someone always ends up with it.',
  11: 'Beef ravioli in meat sauce. The people’s champ. Reliable, beloved, gone in seconds.',
  12: 'Mexican style chicken stew. Warm, capable, criminally underrated. The sleeper pick.',
};

// Original glyph for the Ball Pay button: two circles. That's it. That's the logo.
const BALLS_SVG = `
  <svg viewBox="0 0 26 16" width="22" height="14" aria-hidden="true">
    <circle cx="8" cy="9" r="6.4" fill="currentColor"/>
    <circle cx="18" cy="9" r="6.4" fill="currentColor"/>
    <circle cx="6" cy="6.8" r="1.5" fill="#000" opacity=".35"/>
    <circle cx="16" cy="6.8" r="1.5" fill="#000" opacity=".35"/>
  </svg>`;

// The CSS-drawn "product photo": a tan MRE pouch on white.
// size: '' (grid tile) | 'big' (product page) | 'thumb' (checkout row)
function pouchHTML(m, size = '') {
  return `
    <div class="ph ${size}">
      <div class="pouch">
        <div class="p-band">U.S. GOVERNMENT PROPERTY</div>
        <div class="p-legal">MEAL, READY-TO-EAT</div>
        <div class="p-menu">MENU NO. ${m.menu_no}</div>
        <div class="mre-name">${esc(m.name)}</div>
        <div class="p-nsn">NSN ${esc(m.nsn)}</div>
      </div>
    </div>`;
}

// Shop chrome: small box logo, tiny lowercase nav.
// active: 'shop' | 'cart' | 'manifest'
function pageHeader(active = 'shop') {
  const n = getCart() ? 1 : 0;
  return `
    <header class="sup-header">
      <div class="boxlogo small">supremRe<span class="tm">™</span></div>
      <nav class="sup-nav">
        <a id="nav-shop" class="${active === 'shop' ? 'active' : ''}">shop</a>
        <a id="nav-cart" class="${active === 'cart' ? 'active' : ''}">cart${n ? ` (${n})` : ''}</a>
        <a id="nav-lookbook" class="${active === 'lookbook' ? 'active' : ''}">lookbook</a>
        <a id="nav-manifest" class="${active === 'manifest' ? 'active' : ''}">manifest</a>
        <span class="op">${esc(state.me)}</span>
      </nav>
    </header>`;
}

function wireHeader() {
  const shop = document.getElementById('nav-shop');
  const cart = document.getElementById('nav-cart');
  const lookbook = document.getElementById('nav-lookbook');
  const manifest = document.getElementById('nav-manifest');
  if (shop) shop.onclick = showGrid;
  if (cart) cart.onclick = showCart;
  if (lookbook) lookbook.onclick = showLookbook;
  if (manifest) manifest.onclick = showManifest;
}

// ---------------- history router ----------------
// Still one page, but every view claims a hash route so the browser back
// button walks the shop → product → cart → checkout stack like people expect.
let fromPop = false;

function setRoute(hash) {
  const cur = location.hash;
  if (cur === hash) return;
  // First paint on a bare URL: stamp #/shop via replace so the initial entry
  // carries a real route (otherwise the next push would replace it instead).
  if (!cur && hash === '#/shop') return history.replaceState(null, '', hash);
  // popstate navigation must not add history entries.
  if (fromPop || !cur) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
}

// Result screens collapse the payment stack: back from them should land on
// the shop, not replay a spent checkout.
const routeReplace = (hash) => history.replaceState(null, '', hash);

function routeFromHash() {
  const h = location.hash;
  if (!state.me && h !== '#reset' && h !== '#admin') return showGate();
  if (h === '#reset' || h === '#admin') return showAdmin();
  const p = h.replace(/^#\/?/, '').split('/');
  switch (p[0]) {
    case 'product':  return showProduct(Number(p[1]));
    case 'cart':     return showCart();
    case 'checkout': return showCheckout(Number(p[1]));
    case 'pay': {
      const pay = { ballpay: showBallPay, card: showCardForm, playpal: showPlaypal }[p[1]];
      return pay ? pay(Number(p[2])) : route();
    }
    case 'manifest': return showManifest();
    case 'lookbook': return showLookbook();
    default:         return route();
  }
}

window.addEventListener('popstate', () => {
  fromPop = true;
  try { routeFromHash(); } finally { fromPop = false; }
});
const item = (id) => state.mres.find((m) => m.id === id);
const myClaim = () => state.mres.find((m) => m.claimed_by === state.me);
const claimedCount = () => state.mres.filter((m) => m.claimed).length;
// Drop ends when every operative holds a kit — leftover items become surplus.
const dropOver = () => state.mres.length > 0
  && claimedCount() >= Math.min(state.playerCount, state.mres.length);

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
  if (cfg.player_count) state.playerCount = cfg.player_count;
}

// ---------------- polling ----------------
let pollCount = 0;
function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(async () => {
    // Every ~10th poll, re-sync drop_time so an admin reset that reschedules
    // the drop pulls live clients back to the countdown without a refresh.
    if (++pollCount % 10 === 0) {
      await syncConfig().catch(() => {});
      if (state.dropTime && serverNow() < state.dropTime
          && (state.view === 'grid' || state.view === 'manifest')) {
        return showCountdown();
      }
    }
    try { await refreshStock(); } catch { return; }
    // Only the grid rerenders on poll — never clobber a form mid-checkout.
    if (state.view === 'grid') {
      if (!dropOver()) manifestAutoShown = false;
      // Flip to the manifest once when the drop completes; after that the
      // grid stays browseable as surplus without bouncing the user off it.
      if (dropOver() && !manifestAutoShown) return showManifest();
      renderGrid();
    }
  }, CFG.POLL_MS);
}
let manifestAutoShown = false;

function setView(name, bodyTheme) {
  state.view = name;
  if (bodyTheme) document.body.className = bodyTheme;
  clearInterval(state.tickTimer);
  state.tickTimer = null;
  window.scrollTo(0, 0);
}

// ================= GATE (pick your name) =================
function showGate(msg = '') {
  setRoute('#/shop');
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
        no login, no password. your name is your claim key.
      </p>
    </div>`;
  const input = document.getElementById('namein');
  input.focus();
  const submit = async () => {
    const name = input.value.trim().toUpperCase().replace(/\s+/g, ' ');
    if (name.length < 2) return showGate('THAT NAME IS TOO SHORT.');
    try { await refreshStock(); } catch {}
    // Name is the claim key. If it already holds a kit, this is probably the
    // same person on a new device — confirm instead of locking them out.
    const holder = state.mres.find((m) => m.claimed_by === name);
    if (holder) return showGateConfirm(name, holder);
    state.me = name;
    localStorage.setItem(LS.name, name);
    route();
  };
  document.getElementById('enlist').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// A name that already claimed re-entering from a fresh device: let the real
// owner continue (they can't claim again anyway — one_each has them covered).
function showGateConfirm(name, m) {
  setView('gate', 'theme-drab');
  $app.innerHTML = `
    <div class="briefing">
      <div class="classified mono">// RESTRICTED // RATION OPS //</div>
      <div class="boxlogo">supremRe<span class="tm">™</span></div>
      <h1 class="stencil">Welcome Back?</h1>
      <p class="sub">menu no. ${m.menu_no} &mdash; ${esc(m.name)} is already secured under this name</p>
      <div style="margin:24px 0 10px">
        <button id="its-me" class="btn btn-red btn-block" style="margin-bottom:10px">THAT'S ME &mdash; CONTINUE AS ${esc(name)}</button>
        <button id="not-me" class="btn btn-block" style="background:var(--drab-dark);color:var(--sand)">PICK A DIFFERENT NAME</button>
      </div>
      <p class="mono" style="font-size:.72rem;opacity:.7">
        if this isn't you, someone in the group chat owes an explanation.
      </p>
    </div>`;
  document.getElementById('its-me').onclick = () => {
    state.me = name;
    localStorage.setItem(LS.name, name);
    route();
  };
  document.getElementById('not-me').onclick = () => showGate();
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
  setRoute('#/shop');
  setView('countdown', 'theme-drab');
  $app.innerHTML = `
    <div class="briefing">
      <div class="classified mono">// OPERATION: CHOW CALL // EYES ONLY //</div>
      <div class="boxlogo">supremRe<span class="tm">™</span></div>
      <h1 class="stencil">Ration Drop Imminent</h1>
      <p class="sub">${state.mres.length || 12} meals &middot; ${state.playerCount} operatives &middot; first come, first served</p>
      <div id="clock" class="clock">--:--</div>
      <p class="queuepos">YOU ARE <b id="qpos">#—</b> IN LINE OF ~${CFG.FAKE_QUEUE_TOTAL.toLocaleString()}</p>
      <div class="rules">
        <h3>RULES OF THE DROP</h3>
        <li>ONE (1) MRE PER OPERATIVE. ${esc(String(state.playerCount))} KITS END THE DROP.</li>
        <li>FIRST COME, FIRST SERVE. PAYMENT COMPLETION IS THE ONLY LOCK.</li>
        <li>IF YOUR MENU IS SECURED BY ANOTHER OPERATIVE, DEPLOY FOR ANOTHER.</li>
        <li>ALL SALES FINAL. ESPECIALLY THE MAPLE SAUSAGE.</li>
      </div>
      <button id="lookbook-link" class="btn btn-red" style="margin-top:18px">VIEW THE LOOKBOOK</button>
      <p class="mono" style="margin-top:14px;font-size:.72rem;opacity:.7">logged in as ${esc(state.me)}</p>
    </div>`;
  document.getElementById('lookbook-link').onclick = showLookbook;

  const total = Math.max(state.dropTime - serverNow(), 1);
  const q0 = queueStart();
  let ticks = 0;
  // The queue only moves every few seconds — real queues lurch, they don't hum.
  let nextQueueAt = 0;
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
    if (Date.now() >= nextQueueAt) {
      nextQueueAt = Date.now() + 4000 + Math.random() * 5000;
      const pos = Math.max(1, Math.floor(q0 * (left / total)) - Math.floor(Math.random() * 25));
      document.getElementById('qpos').textContent = `#${pos.toLocaleString()}`;
    }
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
  refreshStock().then(() => (dropOver() ? showManifest() : showGrid())).catch(showGrid);
}

// ================= DROP GRID =================
function showGrid() {
  setRoute('#/shop');
  setView('grid', 'theme-red');
  startPolling();
  renderGrid();
}

function renderGrid() {
  const mine = myClaim();
  const over = dropOver();
  // Supreme shop grid: photos only. No captions, no borders, no tier badges.
  const tiles = state.mres.map((m) => {
    const sold = m.claimed;
    return `
      <button class="tile ${sold ? 'sold' : ''}" data-id="${m.id}"
              ${sold || mine || over ? 'disabled' : ''}
              ${sold ? `title="secured by ${esc(m.claimed_by)}"` : ''}>
        ${pouchHTML(m)}
        ${sold ? '<div class="soldout"><span>sold out</span></div>' : ''}
      </button>`;
  }).join('');

  const status = mine
    ? `KIT SECURED: <b>MENU NO. ${mine.menu_no} — ${esc(mine.name)}</b>. ONE PER OPERATIVE.`
    : over
      ? `DROP COMPLETE. REMAINING STOCK IS SURPLUS.`
      : `DROP IS LIVE. ITEMS ARE NOT HELD UNTIL PAYMENT COMPLETES.`;

  $app.innerHTML = `
    ${pageHeader('shop')}
    <div class="mystatus">${status}</div>
    <div class="grid">${tiles}</div>`;
  wireHeader();

  if (!mine && !over) {
    $app.querySelectorAll('.tile:not(.sold)').forEach((t) => {
      t.onclick = () => showProduct(Number(t.dataset.id));
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
        <div class="ci-meta">menu no. ${m.menu_no} / nsn ${esc(m.nsn)}</div>
      </div>
    </div>`;
}

// Product page, Supreme-style: photo left; name / style / description /
// price / red add-to-cart button right.
function showProduct(id) {
  const m = item(id);
  if (!m || m.claimed) return showGrid();
  state.itemId = id;
  setRoute(`#/product/${id}`);
  setView('product', 'theme-red');
  const inCart = getCart() === id;
  $app.innerHTML = `
    ${pageHeader('shop')}
    <div class="product">
      ${pouchHTML(m, 'big')}
      <div class="pd">
        <h1 class="pd-name">${esc(m.name)}</h1>
        <p class="pd-style">Menu No. ${m.menu_no} / Meal, Ready-to-Eat, Individual</p>
        <p class="pd-desc">${esc(DESC[m.menu_no] || 'Meal, Ready-to-Eat. Individual. Contents classified.')}</p>
        <p class="pd-price">$0.00 <small>&mdash; 1 per operative. item is not held until payment completes.</small></p>
        <button id="add-cart" class="addcart">${inCart ? 'in cart — view cart' : 'add to cart'}</button>
        <button class="backlink" id="back">back to shop</button>
      </div>
    </div>`;
  wireHeader();
  document.getElementById('add-cart').onclick = () => {
    setCart(id);
    showCart();
  };
  document.getElementById('back').onclick = showGrid;
}

// Cart: single item, client-side only. Nothing is reserved by carting.
function showCart() {
  setRoute('#/cart');
  setView('cart', 'theme-red');
  const id = getCart();
  const m = id ? item(id) : null;

  if (!m) {
    setCart(null);
    $app.innerHTML = `
      ${pageHeader('cart')}
      <p class="cart-empty">your cart is empty.</p>
      <button class="backlink" id="back">keep shopping</button>`;
    wireHeader();
    document.getElementById('back').onclick = showGrid;
    return;
  }

  // Carted item got secured by someone else while they hesitated.
  const gone = m.claimed && m.claimed_by !== state.me;
  $app.innerHTML = `
    ${pageHeader('cart')}
    <div class="cart-row ${gone ? 'gone' : ''}">
      ${pouchHTML(m, 'thumb')}
      <div class="cart-info">
        <div class="ci-name">${esc(m.name)}</div>
        <div class="ci-meta">menu no. ${m.menu_no}</div>
        ${gone ? `<div class="cart-gone">sold out &mdash; secured by ${esc(m.claimed_by)}</div>` : ''}
      </div>
      <div class="cart-price">$0.00</div>
      <button class="cart-remove" id="cart-remove">remove</button>
    </div>
    <div class="cart-total"><span>subtotal</span><span>$0.00</span></div>
    ${gone
      ? `<button id="deploy-another" class="addcart">deploy for another</button>`
      : `<button id="checkout" class="addcart">checkout now</button>`}
    <button class="backlink" id="back">keep shopping</button>`;
  wireHeader();
  document.getElementById('cart-remove').onclick = () => { setCart(null); showCart(); };
  document.getElementById('back').onclick = showGrid;
  const deploy = document.getElementById('deploy-another');
  if (deploy) deploy.onclick = () => { setCart(null); showGrid(); };
  const checkout = document.getElementById('checkout');
  if (checkout) checkout.onclick = () => showCheckout(m.id);
}

// Checkout: the three payment doors. All theater — each converges on /claim.
function showCheckout(id, notice = '') {
  const m = item(id);
  if (!m || m.claimed) return showCart();
  state.itemId = id;
  setRoute(`#/checkout/${id}`);
  setView('checkout', 'theme-red');
  const bpDone = localStorage.getItem(LS.ballpay) === '1';
  $app.innerHTML = `
    ${checkoutHeader(m)}
    ${notice ? `<div class="pp-loss">${esc(notice)}</div>` : ''}
    <p class="pay-lead">select payment method. item is not held while you pay.</p>
    <div class="paydoors">
      <button class="paydoor" data-pay="ballpay">
        <span class="pd-buy pd-ballpay">${BALLS_SVG}<i>BallPay</i></span>
        <span class="pd-tag">${bpDone ? 'verification on file. instant.' : 'photo-verified payment. if you dare.'}</span>
      </button>
      <button class="paydoor" data-pay="card">
        <span class="pd-buy">card</span>
        <span class="pd-tag">standard secure checkout. thorough. very thorough.</span>
      </button>
      <button class="paydoor" data-pay="playpal">
        <span class="pd-buy pd-playpal"><i>Play</i><b>Pal</b></span>
        <span class="pd-tag">play and win two games of chance to check out.</span>
      </button>
    </div>
    <button class="backlink" id="back">back to cart</button>`;
  wireHeader();
  $app.querySelector('[data-pay="ballpay"]').onclick = () => showBallPay(id);
  $app.querySelector('[data-pay="card"]').onclick = () => showCardForm(id);
  $app.querySelector('[data-pay="playpal"]').onclick = () => showPlaypal(id);
  document.getElementById('back').onclick = showCart;
}

// ================= BALL PAY (courage) =================
// Three steps: upload proof -> fake analysis -> pay now. The "verification on
// file" flag skips straight to pay now on later attempts.
const BP_FINE = `
  <div class="bp-fine">
    photo is processed locally and never leaves your device.<br>
    a note from the operator: &ldquo;I trained an image AI model to recognize
    their balls specifically, and I will be running it on the photos they
    upload.&rdquo;<br>
    thank you for your cooperation.
  </div>`;

function showBallPay(id) {
  const m = item(id);
  if (!m) return showGrid();
  setRoute(`#/pay/ballpay/${id}`);
  setView('ballpay', 'theme-red');
  const bpDone = localStorage.getItem(LS.ballpay) === '1';

  const shell = (inner) => `
    ${checkoutHeader(m)}
    <div class="ballpay-drop">
      <div class="bp-big">BALL PAY&trade; PAYMENT VERIFICATION</div>
      ${inner}
    </div>
    <div id="bp-status" class="notice"></div>
    <button class="backlink" id="back">other payment methods</button>`;

  const wire = () => {
    wireHeader();
    document.getElementById('back').onclick = () => showCheckout(id);
  };

  // Step 3: verified (now or previously) — one button between you and the claim.
  const renderPayStep = (fresh) => {
    if (state.view !== 'ballpay') return;
    $app.innerHTML = shell(`
      <p class="bp-success">${fresh ? 'success! balls verified.' : 'balls verification on file.'}</p>
      <p>payment method armed.</p>
      <button id="bp-go" class="btn btn-red">pay now</button>
      ${BP_FINE}`);
    wire();
    document.getElementById('bp-go').onclick = () => {
      document.getElementById('bp-status').textContent = 'PROCESSING PAYMENT...';
      fireClaim(id);
    };
  };

  // Step 2: the "analysis". Lines appear over BALLPAY_VERIFY_MS, then success.
  const renderAnalysis = () => {
    $app.innerHTML = shell(`
      <p>ANALYZING PROOF OF PAYMENT...</p>
      <div class="bp-scan" id="bp-scan"></div>
      ${BP_FINE}`);
    wire();
    const lines = [
      'ISOLATING SUBJECT...',
      'SUBJECT DETECTED.',
      'COMPARING AGAINST KNOWN FRIENDS...',
      'MATCH CONFIDENCE: 99.1%',
    ];
    const scan = document.getElementById('bp-scan');
    const stepMs = CFG.BALLPAY_VERIFY_MS / (lines.length + 1);
    lines.forEach((line, i) => {
      setTimeout(() => {
        if (state.view !== 'ballpay' || !document.getElementById('bp-scan')) return;
        scan.innerHTML += `<div>${line}</div>`;
      }, stepMs * (i + 1));
    });
    setTimeout(() => {
      // User may have backed out (browser back) mid-analysis.
      if (state.view !== 'ballpay') return;
      localStorage.setItem(LS.ballpay, '1');
      renderPayStep(true);
    }, CFG.BALLPAY_VERIFY_MS);
  };

  // Step 1: upload. What the photo must depict is now stated explicitly.
  const renderUploadStep = () => {
    $app.innerHTML = shell(`
      <p class="bp-instruction">upload a photo of your balls.<br>this is the payment.</p>
      <label class="filelabel" for="bp-file">upload proof of payment</label>
      <input type="file" id="bp-file" accept="image/*">
      ${BP_FINE}`);
    wire();
    document.getElementById('bp-file').onchange = (e) => {
      if (e.target.files.length > 0) renderAnalysis();
    };
  };

  bpDone ? renderPayStep(false) : renderUploadStep();
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
  { key: 'school', label: '6. Elementary school attended', hint: 'we will not verify.',
    validate: (v) => v.trim() ? null : 'REQUIRED.' },
  { key: 'water', label: '7. Favorite water brand', hint: 'be honest',
    validate: (v) => !v.trim() ? 'REQUIRED.' : /dasani/i.test(v) ? 'BE SERIOUS.' : null },
  { key: 'teeth', label: '8. Number of teeth you currently have', hint: 'count if unsure.',
    validate: (v) => { const n = Number(v.trim()); return Number.isInteger(n) && n >= 0 && n <= 32 ? null : 'MUST BE BETWEEN 0 AND 32.'; } },
  { key: 'maiden_color', label: '9. Mother’s maiden name’s favorite color', hint: 'the color the name would like',
    validate: (v) => v.trim() ? null : 'REQUIRED.' },
  { key: 'ssn4', label: '10. Last 4 digits of a stranger’s SSN', hint: 'a stranger’s, not yours.',
    validate: (v) => /^\d{4}$/.test(v.trim()) ? null : 'EXACTLY 4 DIGITS.' },
];

const loadCard = () => { try { return JSON.parse(localStorage.getItem(LS.card)) || {}; } catch { return {}; } };

// Saved-card summary panel + "pay now". Reached after "save card info", or
// immediately on later visits (the rebound path).
function renderSavedCard(id) {
  const m = item(id);
  const c = loadCard();
  const last4 = (c.phone || '').slice(-4) || '0000';
  $app.innerHTML = `
    ${checkoutHeader(m)}
    <div class="savedcard">
      <div class="sc-panel">
        <div class="sc-label">card on file</div>
        <div class="sc-name">${esc((c.legal_name || 'OPERATIVE').toUpperCase())}</div>
        <div class="sc-num">operative card &bull;&bull;&bull;&bull; ${esc(last4)}</div>
        <div class="sc-meta">teeth on record: ${esc(c.teeth || '?')} &middot; hydration: ${esc(c.water || 'unknown')}</div>
      </div>
      <button id="card-pay" class="btn btn-red">pay now</button>
      <button class="backlink" id="card-edit">edit info</button>
    </div>
    <div class="notice" id="cf-status"></div>
    <button class="backlink" id="back">other payment methods</button>`;
  wireHeader();
  document.getElementById('back').onclick = () => showCheckout(id);
  document.getElementById('card-edit').onclick = () => {
    localStorage.removeItem(LS.cardSaved);
    showCardForm(id);
  };
  document.getElementById('card-pay').onclick = () => {
    document.getElementById('cf-status').textContent = 'CHARGING CARD...';
    fireClaim(id);
  };
}

function showCardForm(id) {
  const m = item(id);
  if (!m) return showGrid();
  setRoute(`#/pay/card/${id}`);
  setView('card', 'theme-red');
  // Card already saved -> straight to the pay-now panel (fast rebound).
  if (localStorage.getItem(LS.cardSaved) === '1') return renderSavedCard(id);
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
      <button type="submit" class="btn btn-red btn-block">save card info</button>
      <div class="notice" id="cf-status"></div>
    </form>
    <button class="backlink" id="back">other payment methods</button>`;
  wireHeader();
  document.getElementById('back').onclick = () => showCheckout(id);

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
    localStorage.setItem(LS.cardSaved, '1');
    renderSavedCard(id);
  };
}

// ================= PLAYPAL (luck) =================
const REEL_SYMBOLS = ['★', '⚙', '✚', '❀', '⚡', '♟'];

function showPlaypal(id) {
  const m = item(id);
  if (!m) return showGrid();
  setRoute(`#/pay/playpal/${id}`);
  setView('playpal', 'theme-red');
  $app.innerHTML = `
    ${checkoutHeader(m)}
    <div class="playpal">
      <div class="pp-title">Playpal&trade; &mdash; game 1 of 2: the spin</div>
      <div class="reels">
        <div class="reel" id="r0">?</div>
        <div class="reel" id="r1">?</div>
        <div class="reel" id="r2">?</div>
      </div>
      <button id="spin" class="btn btn-red">SPIN</button>
      <div class="pp-fine">
        play and win BOTH games to check out. no refunds. no financial advice.<br>
        spin as many times as you need.
      </div>
      <div class="notice" id="pp-status"></div>
    </div>
    <button class="backlink" id="back">other payment methods</button>`;
  wireHeader();
  document.getElementById('back').onclick = () => showCheckout(id);

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
      // User may have backed out (browser back) mid-spin.
      if (state.view !== 'playpal') return;
      reels.forEach((r) => r.classList.remove('spinning'));
      if (win) {
        reels.forEach((r) => { r.textContent = '★'; });
        document.getElementById('pp-status').textContent = 'GAME 1 CLEARED. THE WHEEL AWAITS.';
        setTimeout(() => { if (state.view === 'playpal') renderWheel(id); }, 900);
      } else {
        // A loss just burns time — roll again. The clock is the punishment.
        reels.forEach((r, i) => { r.textContent = REEL_SYMBOLS[(i * 2 + 1) % REEL_SYMBOLS.length]; });
        document.getElementById('pp-status').textContent = 'INSUFFICIENT LUCK. SPIN AGAIN.';
        btn.textContent = 'SPIN AGAIN';
        btn.disabled = false;
      }
    }, CFG.PLAYPAL_SPIN_MS);
  };
}

// Game 2: the Wheel of Rations. 8 wedges, alternating WIN/LOSE visually;
// the outcome comes from PLAYPAL_WHEEL_RATE and the wheel lands to match.
function renderWheel(id) {
  const m = item(id);
  $app.innerHTML = `
    ${checkoutHeader(m)}
    <div class="playpal">
      <div class="pp-title">Playpal&trade; &mdash; game 2 of 2: the wheel of rations</div>
      <div class="wheel-rig">
        <div class="wheel-pointer">&#9660;</div>
        <div class="wheel" id="wheel">
          ${Array.from({ length: 8 }, (_, i) =>
            `<span class="wedge-label" style="transform:rotate(${i * 45 + 22.5}deg) translateY(-58px)">${i % 2 === 0 ? 'PAY' : 'NO'}</span>`
          ).join('')}
        </div>
      </div>
      <button id="wheel-spin" class="btn btn-red">SPIN THE WHEEL</button>
      <div class="pp-fine">
        even wedge: approved. odd wedge: denied. spin until fate cooperates.<br>
        the wheel is calibrated. the wheel is fair. the wheel does not hurry.
      </div>
      <div class="notice" id="pp-status"></div>
    </div>
    <button class="backlink" id="back">other payment methods</button>`;
  wireHeader();
  document.getElementById('back').onclick = () => showCheckout(id);

  // Cumulative rotation so retries animate onward instead of snapping back.
  let rotation = 0;
  document.getElementById('wheel-spin').onclick = () => {
    const btn = document.getElementById('wheel-spin');
    btn.disabled = true;
    const win = Math.random() < CFG.PLAYPAL_WHEEL_RATE;
    // Land the pointer inside a wedge matching the outcome: wedge k spans
    // [k*45, k*45+45); pick an even wedge for a win, odd for a loss, plus
    // jitter so it never lands on a boundary.
    const wedge = 2 * Math.floor(Math.random() * 4) + (win ? 0 : 1);
    const withinWedge = 8 + Math.random() * 29;
    const landing = 360 - (wedge * 45 + withinWedge);
    rotation = (Math.ceil(rotation / 360) + 5) * 360 + landing;
    const wheel = document.getElementById('wheel');
    wheel.style.transition = `transform ${CFG.PLAYPAL_WHEEL_MS}ms cubic-bezier(.17,.67,.16,1)`;
    wheel.style.transform = `rotate(${rotation}deg)`;

    setTimeout(() => {
      // User may have backed out (browser back) mid-wheel.
      if (state.view !== 'playpal') return;
      if (win) {
        document.getElementById('pp-status').textContent = 'BOTH GAMES CLEARED.';
        const claimBtn = document.createElement('button');
        claimBtn.id = 'claim-winnings';
        claimBtn.className = 'btn btn-red';
        claimBtn.textContent = 'claim winnings';
        claimBtn.onclick = () => {
          document.getElementById('pp-status').textContent = 'TRANSFERRING WINNINGS...';
          fireClaim(id);
        };
        btn.replaceWith(claimBtn);
      } else {
        // Denied — but the wheel holds no grudge. Spin again.
        document.getElementById('pp-status').textContent = 'THE WHEEL HAS SPOKEN. SPIN AGAIN.';
        btn.textContent = 'SPIN AGAIN';
        btn.disabled = false;
      }
    }, CFG.PLAYPAL_WHEEL_MS + 200);
  };
}

// ================= RESULT SCREENS =================
function renderSecured(it) {
  routeReplace('#/shop');
  setCart(null);
  setView('secured', 'theme-red');
  $app.innerHTML = `
    <div class="fullscreen fs-white">
      <div class="fs-eyebrow">TRANSACTION COMPLETE</div>
      <h1 style="color:var(--red)">SECURED</h1>
      <div class="fs-detail">MENU NO. ${it.menu_no} — ${esc(it.name)}</div>
      <div class="fs-op stencil">KIT ASSIGNED TO ${esc(it.claimed_by)}</div>
      <button id="go" class="btn btn-red">RETURN TO THE DROP</button>
    </div>`;
  document.getElementById('go').onclick = () => (dropOver() ? showManifest() : showGrid());
}

// The group-chat moment. Must be fast to leave.
function renderTooSlow(mreId, winner) {
  routeReplace('#/shop');
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
  document.getElementById('go').onclick = () => (dropOver() ? showManifest() : showGrid());
}

function renderAlreadyHave(menuNo) {
  routeReplace('#/shop');
  setCart(null);
  setView('alreadyhave', 'theme-red');
  $app.innerHTML = `
    <div class="fullscreen fs-white">
      <div class="fs-eyebrow">SUPPLY DISCIPLINE</div>
      <h1>ONE PER<br>OPERATIVE</h1>
      <div class="fs-detail">YOU ALREADY HOLD MENU NO. ${esc(menuNo)}. ONE PER OPERATIVE.</div>
      <button id="go" class="btn btn-red">RETURN TO THE DROP</button>
    </div>`;
  document.getElementById('go').onclick = () => (dropOver() ? showManifest() : showGrid());
}

function renderTransmissionLost(mreId) {
  routeReplace('#/shop');
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
  'THE MAPLE PUCK CHOOSES ITS OWN. OUR CONDOLENCES,',
  'SOMEONE HAD TO. IT WAS ALWAYS GOING TO BE',
  'A GRATEFUL NATION MOURNS THE BREAKFAST OF',
];

async function showManifest() {
  setRoute('#/manifest');
  setView('manifest', 'theme-red');
  let data;
  try { data = await apiGet('/manifest'); } catch { return showGrid(); }

  const rows = data.claimed.map((r) => `
    <div class="m-row">
      <div class="m-op">${esc(r.claimed_by)}</div>
      <div class="m-item">
        <div class="nm">${esc(r.name)}</div>
        <div class="mn">MENU NO. ${r.menu_no} · NSN ${esc(r.nsn)}</div>
      </div>
    </div>`).join('');

  // The maple sausage puck inherits the vomelette's condolence.
  const cursed = data.claimed.find((r) => /maple/i.test(r.name));
  const condolence = cursed
    ? `<div class="condolence">${CONDOLENCES[cursed.menu_no % CONDOLENCES.length]} ${esc(cursed.claimed_by)}.</div>`
    : '';

  const players = data.player_count ?? state.playerCount;
  const surplus = data.total - data.claimed.length;
  $app.innerHTML = `
    <div class="manifest">
      <div class="m-head">
        <div class="boxlogo small">supremRe<span class="tm">™</span></div>
        <h2>AFTER ACTION REPORT</h2>
      </div>
      <div class="m-sub">// RATION DROP MANIFEST // ${data.claimed.length}/${players} OPERATIVES SERVED // ${surplus} SURPLUS // ALL SALES FINAL //</div>
      ${rows || '<p class="mono">no kits assigned yet.</p>'}
      ${condolence}
      <div class="m-foot">supremRe&trade; &middot; Meal, Ready-to-Eat &middot; unauthorized resale is discouraged</div>
    </div>
    <div style="text-align:center"><button class="backlink" id="back-shop">${data.complete ? 'browse the surplus' : 'back to shop'}</button></div>`;
  const back = document.getElementById('back-shop');
  if (back) back.onclick = showGrid;
}

// ================= LOOKBOOK (flavor preview — browsable before the drop) =================
async function showLookbook() {
  setRoute('#/lookbook');
  setView('lookbook', 'theme-red');
  if (state.mres.length === 0) { try { await refreshStock(); } catch {} }
  const preDrop = state.dropTime && serverNow() < state.dropTime;

  const entries = state.mres.map((m, idx) => `
    <figure class="lb-entry">
      ${pouchHTML(m, 'big')}
      <figcaption>
        <span class="lb-num">${String(idx + 1).padStart(2, '0')}/${String(state.mres.length).padStart(2, '0')}</span>
        <span class="lb-name">${esc(m.name)}</span>
        <p class="lb-desc">${esc(DESC[m.menu_no] || 'Meal, Ready-to-Eat. Individual.')}</p>
      </figcaption>
    </figure>`).join('');

  // Deliberately minimal chrome: pre-drop this page must not leak into the shop.
  $app.innerHTML = `
    <header class="sup-header">
      <div class="boxlogo small">supremRe<span class="tm">™</span></div>
      <nav class="sup-nav"><span class="op">${esc(state.me)}</span></nav>
    </header>
    <div class="lb-head">
      <h1 class="lb-title">Lookbook</h1>
      <div class="lb-sub mono">DROP 001 &mdash; MEAL, READY-TO-EAT &mdash; ${state.mres.length} MENUS &mdash; FLAVOR PREVIEW</div>
    </div>
    <div class="lookbook">${entries}</div>
    <div style="text-align:center;padding:18px 0">
      <button class="backlink" id="lb-back">${preDrop ? 'back to the countdown' : 'back to the shop'}</button>
    </div>`;
  document.getElementById('lb-back').onclick = () => (preDrop ? showCountdown() : showGrid());
}

// ================= COMMAND POST (dev reset, #reset in the URL) =================
async function showAdmin() {
  setRoute('#reset');
  setView('admin', 'theme-drab');
  const savedSecret = localStorage.getItem(LS.adminSecret) || '';
  $app.innerHTML = `
    <div class="briefing">
      <div class="classified mono">// COMMAND POST // AUTHORIZED PERSONNEL ONLY //</div>
      <div class="boxlogo">supremRe<span class="tm">™</span></div>
      <h1 class="stencil">Command Post</h1>
      <p class="sub">reset the drop between test runs</p>

      <input id="adm-secret" class="gate-input" type="password"
             placeholder="RESET SECRET" value="${esc(savedSecret)}" autocomplete="off">
      <input id="adm-mins" class="gate-input" type="number" min="0" step="1" value="15"
             placeholder="MINUTES UNTIL DROP" style="font-family:var(--courier);font-size:1rem">

      <button id="adm-reset-live" class="btn btn-red btn-block" style="margin-bottom:10px">
        RESET CLAIMS — DROP LIVE NOW
      </button>
      <button id="adm-reset-sched" class="btn btn-red btn-block" style="margin-bottom:16px">
        RESET CLAIMS + COUNTDOWN IN <span id="adm-mins-label">15</span> MIN
      </button>

      <input id="adm-when" class="gate-input" type="datetime-local"
             style="font-family:var(--courier);font-size:1rem">
      <button id="adm-reset-at" class="btn btn-red btn-block" style="margin-bottom:10px">
        RESET CLAIMS + DROP AT SELECTED TIME
      </button>
      <button id="adm-clear-local" class="btn" style="margin-bottom:10px;background:var(--drab-dark);color:var(--sand);width:100%">
        CLEAR THIS BROWSER'S DATA (name, card, ball pay)
      </button>

      <div id="adm-status" class="notice" style="min-height:2.4em"></div>
      <button class="backlink" id="adm-back" style="color:var(--sand)">back to the app</button>
      <p class="mono" style="margin-top:10px;font-size:.7rem;opacity:.6">
        server state lives in postgres; other players' pages pick up a reset
        within ~15s of polling. clearing browser data only affects this device.
      </p>
    </div>`;

  const status = document.getElementById('adm-status');
  const minsInput = document.getElementById('adm-mins');
  minsInput.oninput = () => {
    document.getElementById('adm-mins-label').textContent = minsInput.value || '?';
  };

  // Pre-fill the date picker with the next noon (local time) as a sane default.
  const whenInput = document.getElementById('adm-when');
  {
    const d = new Date();
    if (d.getHours() >= 12) d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
    const p = (n) => String(n).padStart(2, '0');
    whenInput.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const doReset = async (dropInSeconds) => {
    const secret = document.getElementById('adm-secret').value.trim();
    if (!secret) { status.textContent = 'ENTER THE RESET SECRET.'; return; }
    localStorage.setItem(LS.adminSecret, secret);
    status.textContent = 'TRANSMITTING...';
    try {
      const res = await fetch(`${API}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          dropInSeconds === null ? { secret } : { secret, drop_in_seconds: dropInSeconds }
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        status.textContent = body.reason === 'bad_secret'
          ? 'BAD SECRET. ACCESS DENIED.' : `RESET FAILED (${res.status}).`;
        return;
      }
      await syncConfig().catch(() => {});
      await refreshStock().catch(() => {});
      const t = body.drop_time ? new Date(body.drop_time).toLocaleString() : 'unchanged';
      status.textContent = `ALL CLAIMS CLEARED. DROP TIME: ${t}.`;
    } catch {
      status.textContent = 'TRANSMISSION FAILED. IS THE API UP?';
    }
  };

  document.getElementById('adm-reset-live').onclick = () => doReset(-1);
  document.getElementById('adm-reset-sched').onclick = () => {
    const mins = Number(minsInput.value);
    if (!Number.isFinite(mins) || mins < 0) { status.textContent = 'MINUTES MUST BE A NUMBER.'; return; }
    doReset(Math.round(mins * 60));
  };
  document.getElementById('adm-reset-at').onclick = async () => {
    if (!whenInput.value) { status.textContent = 'PICK A DATE AND TIME.'; return; }
    const target = new Date(whenInput.value).getTime(); // local wall-clock
    // Sync the server clock first so the computed offset is exact even if
    // this device's clock drifts.
    await syncConfig().catch(() => {});
    const secs = Math.round((target - serverNow()) / 1000);
    if (secs <= 0) { status.textContent = 'THAT TIME IS IN THE PAST, TIME TRAVELER.'; return; }
    doReset(secs);
  };
  document.getElementById('adm-clear-local').onclick = () => {
    [LS.name, LS.card, LS.cardSaved, LS.ballpay, LS.queue, LS.cart].forEach((k) => localStorage.removeItem(k));
    state.me = null;
    status.textContent = 'LOCAL DATA WIPED. YOU ARE NOBODY AGAIN.';
  };
  document.getElementById('adm-back').onclick = () => {
    history.replaceState(null, '', location.pathname);
    route();
  };
}

const isAdminHash = () => ['#reset', '#admin'].includes(location.hash);

// ================= BOOT =================
async function route() {
  if (!state.me) return showGate();
  if (state.dropTime && serverNow() < state.dropTime) return showCountdown();
  startPolling();
  try { await refreshStock(); } catch {}
  dropOver() ? showManifest() : showGrid();
}

(async function boot() {
  // The command post works even when the rest of boot would fail —
  // it's the tool you reach for when the drop state is wedged.
  if (isAdminHash()) return showAdmin();
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
  routeFromHash();
})();
