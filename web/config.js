// All friction knobs live here. Tune freely between drops.
window.MEAL_CONFIG = {
  // Point at the Railway API URL in production, e.g. 'https://meal-drop.up.railway.app'
  API_BASE: 'http://localhost:3100',

  POLL_MS: 1500,            // stock poll interval

  PLAYPAL_WIN_RATE: 0.70,   // luck axis
  PLAYPAL_SPIN_MS: 1500,    // reel animation length

  BALLPAY_VERIFY_MS: 900,   // fake "verifying photo" beat before instant pass

  FAKE_QUEUE_TOTAL: 12000,  // "out of ~12,000"
  FAKE_QUEUE_MIN: 8000,     // starting position rolls between MIN and MAX
  FAKE_QUEUE_MAX: 11500,
};
