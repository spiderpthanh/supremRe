// All friction knobs live here. Tune freely between drops.
window.SUPREMRE_CONFIG = {
  // Production API on Railway; local dev automatically talks to localhost.
  API_BASE: ['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://localhost:3100'
    : 'https://supremre-production.up.railway.app',

  POLL_MS: 1500,            // stock poll interval

  PLAYPAL_WIN_RATE: 0.40,   // game 1: slot spin
  PLAYPAL_WHEEL_RATE: 0.75, // game 2: wheel of rations (must win BOTH)
  PLAYPAL_SPIN_MS: 1500,    // reel animation length
  PLAYPAL_WHEEL_MS: 2500,   // wheel spin animation length

  BALLPAY_VERIFY_MS: 2600,  // fake "analyzing photo" screen duration

  FAKE_QUEUE_TOTAL: 12000,  // "out of ~12,000"
  FAKE_QUEUE_MIN: 8000,     // starting position rolls between MIN and MAX
  FAKE_QUEUE_MAX: 11500,
};
