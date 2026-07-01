// =====================================================================
//  Platby přes Stripe — veřejná konfigurace (bezpečné mít v prohlížeči)
// ---------------------------------------------------------------------
//  Používáme Stripe Payment Links (hotové platební odkazy z Stripe).
//  Žádný tajný klíč tady není potřeba — odkazy jsou veřejné.
//
//  Dokud je enabled:false, web funguje bez plateb (rezervace zdarma).
// =====================================================================
window.PAYMENTS = {
  provider: 'stripe',
  enabled: true,

  // Stripe Payment Links (vytvořeno ve Stripe, LIVE):
  entryUrl:   'https://buy.stripe.com/4gM6oH8Hvg8l4G1agd1gs01', // jednorázový vstup 499 Kč
  voucherUrl: 'https://buy.stripe.com/fZu28r7Dr6xLc8t1JH1gs00', // dárkový poukaz 499 Kč

  // Ceny (jen popisky v UI)
  depositCzk: 499,
  voucherCzk: 499,
};
