# ehf-helper

[![CI](https://github.com/bergvictor/ehf-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/bergvictor/ehf-helper/actions/workflows/ci.yml)

Turn a simple invoice JSON into **Peppol BIS Billing 3.0 (EN 16931 / EHF)** UBL XML — the
e-invoice format Norwegian businesses must support ahead of the 2027 mandates. Zero
dependencies, single file, runs anywhere Node 18+ runs.

> Built and maintained by [VImplement](https://www.vimplement.com) — AI, data og operativ software for norske SMB-er.

## Why

From 2027 Norwegian SMBs face expanding e-invoicing / SAF-T obligations. EHF is built on
Peppol BIS Billing 3.0 (UBL 2.1). This helper gives you a tiny, readable starting point for
emitting compliant-shaped XML from your own data — no SDK, no vendor lock-in.

## Install

It's a single zero-dependency ES module — copy `src/ehf.js` into your project, or:

```bash
git clone https://github.com/bergvictor/ehf-helper.git
```

## Usage

```js
import { buildInvoice, summarize } from './src/ehf.js';

const invoice = {
  invoiceNumber: '2026-001',
  issueDate: '2026-06-07',
  dueDate: '2026-06-21',
  currency: 'NOK',
  supplier: {
    name: 'VImplement',
    orgNo: '934134176',
    vatNo: 'NO934134176MVA',
    address: { street: 'Moltke Moes vei 14', city: 'Oslo', postalZone: '0851', country: 'NO' },
  },
  customer: {
    name: 'Kunde AS',
    orgNo: '999888777',
    address: { city: 'Bergen', postalZone: '5003', country: 'NO' },
  },
  lines: [
    { name: 'Power BI dashboard', quantity: 1, unitPrice: 20000, vatPercent: 25 },
    { name: 'Rådgivning (timer)', quantity: 10, unitPrice: 1500, vatPercent: 25 },
  ],
};

summarize(invoice); // { net: 35000, vat: 8750, gross: 43750, breakdown: [...] }
const xml = buildInvoice(invoice); // full UBL Invoice XML string
```

## What it covers

- BIS Billing 3.0 `CustomizationID` / `ProfileID`
- Supplier + customer parties with the Norwegian org-number endpoint scheme (`0192`)
- Invoice lines with per-line VAT category
- Per-rate `TaxSubtotal`s and a reconciled `TaxTotal` / `LegalMonetaryTotal`
- Standard (`S`), reduced, and zero-rated (`Z`) VAT; single document currency
- XML escaping of all text fields

## What it does **not** do (yet)

This is a focused starting point, not a certified solution. It does not handle allowances/charges,
prepaid amounts, rounding adjustments, credit notes (381), foreign-currency tax, attachments, or
delivery details. **Always validate the output with an official validator** before sending in
production — e.g. the [Peppol/EN16931 validator](https://ecosio.com/en/peppol-and-xml-document-validator/)
or the Norwegian [vefa.difi.no](https://vefa.difi.no/) tools.

PRs that extend coverage (with tests) are welcome.

## Develop

```bash
node --test   # runs the test suite (no install needed)
```

## License

MIT © Victor Berg / VImplement
