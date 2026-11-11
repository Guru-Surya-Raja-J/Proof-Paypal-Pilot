/**
 * The merchant's storefront catalog. Prices are authoritative here: the server
 * never trusts a client-supplied amount when it creates a PayPal order.
 *
 * `riskCategory` marks items whose category sees more chargebacks (high value,
 * easily resold) and feeds the HIGH_RISK_CATEGORY risk signal.
 */
export const CATALOG = [
  {
    sku: 'POT-CER-01',
    name: 'Ceramic Teapot & Cup Set',
    price: 129,
    category: 'Ceramics',
    riskCategory: false,
    image: 'teapot',
    description: 'Wheel-thrown stoneware teapot (900 ml) with four matching cups. Speckled oat glaze, food and dishwasher safe. Each piece is handmade, so glaze patterns vary slightly.',
    weightKg: 2.1
  },
  {
    sku: 'LIN-RUN-02',
    name: 'Woven Linen Table Runner',
    price: 42,
    category: 'Textiles',
    riskCategory: false,
    image: 'runner',
    description: '100% stonewashed European linen, 35 × 180 cm, hand-hemmed edges. Natural flax colour. Machine wash cold.',
    weightKg: 0.4
  },
  {
    sku: 'WOD-ACC-53',
    name: 'Walnut Headphone Stand',
    price: 68,
    category: 'Woodwork',
    riskCategory: false,
    image: 'stand',
    description: 'Solid American black walnut, oil-and-wax finish, 27 cm tall with felt-lined base. Cut and finished by hand in our Austin workshop.',
    weightKg: 0.9
  },
  {
    sku: 'CAN-SOY-07',
    name: 'Hand-poured Soy Candle Trio',
    price: 36,
    category: 'Home fragrance',
    riskCategory: false,
    image: 'candle',
    description: 'Three 180 g soy wax candles in amber glass: cedar, fig, and sea salt. Cotton wicks, roughly 40 hours burn time each.',
    weightKg: 1.2
  },
  {
    sku: 'LUX-GLZ-16',
    name: 'Studio Glaze Dinnerware Set (16 pc)',
    price: 486,
    category: 'Limited edition',
    riskCategory: true,
    image: 'dinnerware',
    description: 'Limited run of 30 sets: four each of dinner plates, side plates, bowls and mugs in our signature ocean-blue reactive glaze. Numbered certificate included.',
    weightKg: 9.5
  },
  {
    sku: 'SIL-PEN-21',
    name: 'Sterling Silver Leaf Pendant',
    price: 158,
    category: 'Jewellery',
    riskCategory: true,
    image: 'pendant',
    description: 'Hand-forged .925 sterling silver leaf pendant, 32 mm, on an 18-inch box chain. Hallmarked, ships in a gift box.',
    weightKg: 0.1
  }
]

export const SHIPPING_METHODS = {
  standard: { id: 'standard', label: 'Standard tracked (4-6 business days)', price: 8, businessDays: [4, 6] },
  express: { id: 'express', label: 'Express (1-2 business days)', price: 24, businessDays: [1, 2] }
}

export const STORE_POLICY = {
  version: '2026.11',
  summary: '30-day returns on unused items in original packaging. All orders ship with tracking. Non-receipt claims are investigated against carrier scan records before a refund is issued.',
  terms: [
    'Returns are accepted within 30 days of delivery for unused items in original packaging.',
    'Return shipping is paid by the buyer unless the item arrived damaged or not as described.',
    'Every order ships with carrier tracking. Orders over $250 require a signature on delivery.',
    'Claims of non-receipt are investigated against carrier scan and delivery records.',
    'Handmade items vary slightly in glaze, grain and colour; this is not considered a defect.'
  ]
}

export const findProduct = (sku) => CATALOG.find((product) => product.sku === sku) || null

export const catalogMedianPrice = (() => {
  const prices = CATALOG.map((product) => product.price).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  return prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2
})()
