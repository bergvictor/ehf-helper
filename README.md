# ehf-helper

[![CI](https://github.com/bergvictor/ehf-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/bergvictor/ehf-helper/actions/workflows/ci.yml)

Turn a simple invoice JSON into **Peppol BIS Billing 3.0 (EN 16931 / EHF)** UBL XML — the
e-invoice format Norwegian businesses must support ahead of the 2027 mandates. Zero
dependencies, single file, runs anywhere Node 18+ runs.

> Built and maintained by [VImplement](https://www.vimplement.com/?utm_source=github&utm_medium=readme&utm_campaign=ehf_helper) — AI, data og operativ programvare for norske SMB-er.

Need this in an actual invoice flow? [Book a 20–30 minute call](https://www.vimplement.com/book?utm_source=github&utm_medium=readme&utm_campaign=ehf_helper).

## Why

From 2027 Norwegian SMBs face expanding e-invoicing / SAF-T obligations. EHF is built on
Peppol BIS Billing 3.0 (UBL 2.1). This helper gives you a tiny, readable starting point for
emitting compliant-shaped XML from your own data — no SDK, no vendor lock-in.

## Install

It's a single zero-dependency ES module — copy `src/ehf.js` into your project, or:

```bash
git clone https://github.com/bergvictor/ehf-helper.git
```

## Try it without coding

```bash
node examples/demo.mjs   # builds examples/sample-invoice.json and prints the UBL XML
```

The demo prints the invoice XML plus two lines: where to validate it, and where to book a
call if your real invoice flow gets stuck.

## Usage

```js
import { buildInvoice, summarize } from './src/ehf.js';

const invoice = {
  invoiceNumber: '2026-001',
  issueDate: '2026-06-07',
  dueDate: '2026-06-21',
  buyerReference: 'PO-2026-0042', // BT-10 — required by Peppol BIS 3.0
  currency: 'NOK', // 3-letter ISO 4217 code
  supplier: {
    name: 'Eksempel Leverandør AS',
    orgNo: '987654321', // 9-digit Norwegian organisation number
    vatNo: 'NO987654321MVA', // seller VAT identifier (BT-31) — required, see below
    address: { street: 'Eksempelveien 1', city: 'Oslo', postalZone: '0150', country: 'NO' },
  },
  customer: {
    name: 'Kunde AS',
    orgNo: '999888777',
    address: { city: 'Bergen', postalZone: '5003', country: 'NO' },
  },
  payment: {
    account: '86011117947',  // payee account (BBAN or IBAN)
    meansCode: 30,           // UN/ECE 4461 (default 30, credit transfer)
    kid: '0123456789012',    // Norwegian KID → cbc:PaymentID
  },
  lines: [
    { name: 'Power BI dashboard', quantity: 1, unitPrice: 20000, vatPercent: 25 },
    { name: 'Rådgivning (timer)', quantity: 10, unitPrice: 1500, vatPercent: 25 },
    // { name: 'Exempt service', quantity: 1, unitPrice: 1000, vatPercent: 0,
    //   vatCategory: 'E', vatExemptionReason: 'Exempt: financial services' },
  ],
};

summarize(invoice); // { net: 35000, vat: 8750, gross: 43750, breakdown: [...] }
const xml = buildInvoice(invoice); // full UBL Invoice XML string
```

Invalid inputs throw an `EhfValidationError` naming the field and the rule, e.g.
`supplier.vatNo is required: ...` or `currency must be a 3-letter ISO 4217 code ...`.

## Breaking changes

- **`supplier.vatNo` is now required** (e.g. `"NO987654321MVA"`). Peppol BIS Billing 3.0
  mandates the seller VAT identifier (BT-31): without it, standard-rated invoices fail EN
  16931 rule BR-S-02 at validation. Previously `vatNo` was optional, so the happy path
  could produce XML that fails Peppol validation. To upgrade, add the supplier's VAT
  identifier to your invoice JSON; invoices that omit it now throw `EhfValidationError`
  instead of emitting invalid XML.
- **Inputs are now strictly validated.** Organisation numbers must be 9 digits, dates must
  be real `YYYY-MM-DD` calendar dates, and `currency` must be a 3-letter ISO 4217 code.
  Anything else throws `EhfValidationError` naming the field and the rule.

## What it covers

- BIS Billing 3.0 `CustomizationID` / `ProfileID`
- `cbc:BuyerReference` (BT-10) — required input, per Peppol rule PEPPOL-EN16931-R003
- Seller VAT identifier (BT-31) — required supplier input, per EN 16931 rule BR-S-02
- Supplier + customer parties with the Norwegian org-number endpoint scheme (`0192`)
- Strict input checks: 9-digit org numbers, ISO `YYYY-MM-DD` dates, ISO 4217 currency
- `cac:PaymentMeans` with payee account, optional BIC, and Norwegian KID (`cbc:PaymentID`)
- Invoice lines with explicit per-line VAT category (`S`, `Z`, `E`, `AE`, `K`, `G`, `O`)
  and exemption reasons (`E`/`AE` require 0% VAT plus a reason); defaults stay `S` above
  0% and `Z` at 0%
- Per-rate `TaxSubtotal`s (split by category and reason) and a reconciled
  `TaxTotal` / `LegalMonetaryTotal`
- Standard (`S`), reduced, zero-rated (`Z`), exempt (`E`), reverse-charge (`AE`),
  intra-community (`K`), export (`G`) and out-of-scope (`O`) VAT; single document currency
- XML escaping of all text fields and attribute values

## What it does **not** do (yet)

This is a focused starting point, not a certified solution. It does not handle allowances/charges,
prepaid amounts, rounding adjustments, credit notes (381), foreign-currency tax, attachments, or
delivery details. **Always validate the output with an official validator** before sending in
production — e.g. the [Peppol/EN16931 validator](https://ecosio.com/en/peppol-and-xml-document-validator/)
or the Norwegian [vefa.difi.no](https://vefa.difi.no/) tools. If the validator flags something in
your real invoice flow, [book a 20–30 minute call](https://www.vimplement.com/book?utm_source=github&utm_medium=readme&utm_campaign=ehf_helper)
and we'll help you fix it.

PRs that extend coverage (with tests) are welcome.

> **Stuck on your real invoice flow?** [Book a 20–30 minute call](https://www.vimplement.com/book?utm_source=github&utm_medium=readme&utm_campaign=ehf_helper) — VImplement offers **EHF-sjekk** (12 000 kr) and **EHF-klar** (49 000 kr) to get you compliant ahead of the 2027-01-01 mandate.

## Develop

```bash
node --test   # runs the test suite (no install needed)
```

## License

MIT © Victor Berg / VImplement
