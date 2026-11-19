(function (root) {
  const catalog = Object.freeze({
    before: Object.freeze({
      trial: 'Makeup trial or rehearsal',
      patchTest: 'Sensitivity patch test',
      skinPrep: 'Personalised skin-prep session',
      earlyStart: 'Early start or out-of-hours setup',
      additionalPerson: 'Additional person'
    }),
    after: Object.freeze({
      touchUps: 'On-site touch-ups or standby',
      secondLook: 'Second look or makeup change',
      extendedTime: 'Agreed overtime',
      removal: 'Makeup removal and aftercare',
      takeHomeKit: 'Take-home touch-up kit'
    })
  });

  function line(phase, key, quantity, unitPrice) {
    const name = Object.hasOwn(catalog, phase) && Object.hasOwn(catalog[phase], key) && catalog[phase][key];
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!name || !Number.isSafeInteger(qty) || qty < 1 ||
        String(unitPrice ?? '').trim() === '' || !Number.isFinite(price) || price < 0 ||
        !/^\d+(\.\d{1,2})?$/.test(String(unitPrice))) {
      throw Error('Choose an extra, a whole quantity and an agreed price in AUD');
    }
    return { serviceId: null, extraKey: key, extraPhase: phase,
      name: (phase === 'before' ? 'Before appointment: ' : 'After appointment: ') + name, qty, price };
  }

  root.QuoteExtras = { catalog, line };
})(typeof window === 'undefined' ? globalThis : window);
