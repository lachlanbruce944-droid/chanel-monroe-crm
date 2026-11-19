# Service quote pricing logic

The CRM loads the before- and after-appointment extras from [quote-extras.js](quote-extras.js). These are suggestions. Add only the extras agreed with the client, and enter the agreed AUD unit price and whole quantity. Zero is allowed for a complimentary extra. Use the existing travel fee field for travel.

A service or extra line contributes quantity × unit price. The booking total adds travel and any existing agreed additional costs, subtracts the discount and floors the result at zero. Keep an extra on its own line and avoid duplicating it in the existing additional-cost field. The existing GST and deposit settings apply. Payments are credited against the total, and agreed extras added after the deposit flow into the final balance.

Each quote line stores its own name, quantity and unit price. Changing the catalog does not reprice an existing quote. If an invoice is already issued through Stripe or paid, reconcile it before changing the amount due. Update the catalog here when introducing new suggestions. Future standard rates should prefill the editable price without changing saved quotes.
