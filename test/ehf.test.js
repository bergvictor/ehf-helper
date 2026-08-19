import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoice, summarize } from '../src/ehf.js';

const sample = {
  invoiceNumber: '2026-001',
  issueDate: '2026-06-07',
  dueDate: '2026-06-21',
  buyerReference: 'PO-2026-0042',
  currency: 'NOK',
  supplier: {
    name: 'Eksempel Leverandør AS',
    orgNo: '987654321',
    address: { street: 'Eksempelveien 1', city: 'Oslo', postalZone: '0150', country: 'NO' },
  },
  customer: {
    name: 'Kunde AS',
    orgNo: '999888777',
    address: { city: 'Bergen', postalZone: '5003', country: 'NO' },
  },
  lines: [
    { name: 'Power BI dashboard', quantity: 1, unitPrice: 20000, vatPercent: 25 },
    { name: 'Radgivning (timer)', quantity: 10, unitPrice: 1500, vatPercent: 25 },
  ],
};

test('summarize reconciles net / vat / gross', () => {
  const s = summarize(sample);
  assert.equal(s.net, 35000);
  assert.equal(s.vat, 8750);
  assert.equal(s.gross, 43750);
});

test('totals appear correctly in the XML', () => {
  const xml = buildInvoice(sample);
  assert.match(xml, /<cbc:LineExtensionAmount currencyID="NOK">35000\.00<\/cbc:LineExtensionAmount>/);
  assert.match(xml, /<cbc:TaxInclusiveAmount currencyID="NOK">43750\.00<\/cbc:TaxInclusiveAmount>/);
  assert.match(xml, /<cbc:PayableAmount currencyID="NOK">43750\.00<\/cbc:PayableAmount>/);
});

test('carries the BIS 3.0 identifiers and Norwegian endpoint scheme', () => {
  const xml = buildInvoice(sample);
  assert.match(xml, /urn:cen\.eu:en16931:2017#compliant#urn:fdc:peppol\.eu:2017:poacc:billing:3\.0/);
  assert.match(xml, /<cbc:ProfileID>urn:fdc:peppol\.eu:2017:poacc:billing:01:1\.0<\/cbc:ProfileID>/);
  assert.match(xml, /<cbc:EndpointID schemeID="0192">987654321<\/cbc:EndpointID>/);
  assert.match(xml, /<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/);
});

test('multi-rate VAT yields one subtotal per rate', () => {
  const inv = {
    ...sample,
    lines: [
      { name: 'Standard', quantity: 1, unitPrice: 100, vatPercent: 25 },
      { name: 'Mat', quantity: 1, unitPrice: 100, vatPercent: 15 },
    ],
  };
  const xml = buildInvoice(inv);
  assert.equal((xml.match(/<cac:TaxSubtotal>/g) || []).length, 2);
  // total VAT = 25 + 15 = 40
  assert.match(xml, /<cac:TaxTotal>\s*<cbc:TaxAmount currencyID="NOK">40\.00<\/cbc:TaxAmount>/);
});

test('escapes XML special characters', () => {
  const inv = { ...sample, lines: [{ name: 'A & B <test>', quantity: 1, unitPrice: 100, vatPercent: 25 }] };
  const xml = buildInvoice(inv);
  assert.match(xml, /A &amp; B &lt;test&gt;/);
});

test('emits the buyer reference (BT-10)', () => {
  const xml = buildInvoice(sample);
  assert.match(xml, /<cbc:BuyerReference>PO-2026-0042<\/cbc:BuyerReference>/);
});

test('emits PaymentMeans with account and Norwegian KID', () => {
  const inv = {
    ...sample,
    payment: { account: '86011117947', kid: '0123456789012', accountName: 'Eksempel Leverandør AS', bic: 'SPSONO22' },
  };
  const xml = buildInvoice(inv);
  assert.match(xml, /<cbc:PaymentMeansCode>30<\/cbc:PaymentMeansCode>/);
  assert.match(xml, /<cbc:PaymentID>0123456789012<\/cbc:PaymentID>/);
  assert.match(xml, /<cac:PayeeFinancialAccount>\s*<cbc:ID>86011117947<\/cbc:ID>\s*<cbc:Name>Eksempel Leverandør AS<\/cbc:Name>/);
  assert.match(xml, /<cac:FinancialInstitutionBranch><cbc:ID>SPSONO22<\/cbc:ID><\/cac:FinancialInstitutionBranch>/);
});

test('PaymentMeans honours an explicit means code and stays optional', () => {
  const inv = { ...sample, payment: { account: 'NO9386011117947', meansCode: 58 } };
  const xml = buildInvoice(inv);
  assert.match(xml, /<cbc:PaymentMeansCode>58<\/cbc:PaymentMeansCode>/);
  assert.doesNotMatch(xml, /<cbc:PaymentID>/);
  // no payment info given -> no PaymentMeans block
  assert.doesNotMatch(buildInvoice(sample), /<cac:PaymentMeans>/);
});

test('rejects invalid input', () => {
  assert.throws(() => buildInvoice({ lines: [] }), /invoiceNumber/);
  assert.throws(() => buildInvoice({ invoiceNumber: 'x', issueDate: '2026-01-01', lines: [] }), /buyerReference/);
  assert.throws(
    () => buildInvoice({ invoiceNumber: 'x', issueDate: '2026-01-01', buyerReference: 'ref', lines: [] }),
    /at least one line/
  );
  assert.throws(() => buildInvoice({ ...sample, payment: { kid: '123' } }), /payment requires account/);
});

test('rejects non-finite quantity/unitPrice/vatPercent with the line index and field named', () => {
  const withLine = (line) => ({ ...sample, lines: [line] });
  assert.throws(
    () => summarize(withLine({ name: 'Bad', quantity: 'not-a-number', unitPrice: 100, vatPercent: 25 })),
    /line 0: quantity is not a finite number/
  );
  assert.throws(
    () => summarize(withLine({ name: 'Bad', quantity: 1, unitPrice: Infinity, vatPercent: 25 })),
    /line 0: unitPrice is not a finite number/
  );
  assert.throws(
    () => summarize(withLine({ name: 'Bad', quantity: 1, unitPrice: 100, vatPercent: NaN })),
    /line 0: vatPercent is not a finite number/
  );
});

test('strips XML-illegal C0 control characters from escaped text', () => {
  const inv = { ...sample, note: `bell\x07note` };
  const xml = buildInvoice(inv);
  assert.match(xml, /<cbc:Note>bellnote<\/cbc:Note>/);
  assert.doesNotMatch(xml, /\x07/);
});

test('strips DEL/C1 control characters and lone surrogates while preserving valid surrogate pairs', () => {
  const inv = {
    ...sample,
    note: `del\x7Fc1\x9Flone${String.fromCharCode(0xd800)}high${String.fromCharCode(0xdc00)}low emoji\u{1F600}end`,
  };
  const xml = buildInvoice(inv);
  assert.match(xml, /<cbc:Note>delc1lonehighlow emoji\u{1F600}end<\/cbc:Note>/u);
  assert.doesNotMatch(xml, /\x7F/);
  assert.doesNotMatch(xml, /\x9F/);
});

test('formats non-integer quantities without scientific notation and rejects unsafe magnitudes', () => {
  const inv = { ...sample, lines: [{ name: 'Partial unit', quantity: 2.5, unitPrice: 100, vatPercent: 25 }] };
  const xml = buildInvoice(inv);
  assert.match(xml, /<cbc:InvoicedQuantity unitCode="EA">2\.5<\/cbc:InvoicedQuantity>/);
  assert.throws(
    () => buildInvoice({ ...sample, lines: [{ name: 'Huge', quantity: 1e21, unitPrice: 100, vatPercent: 25 }] }),
    /quantity magnitude is too large/
  );
});

test('PriceAmount preserves sub-cent unit prices while staying byte-identical for whole-cent inputs', () => {
  const inv = { ...sample, lines: [{ name: 'Sub-cent', quantity: 8, unitPrice: 0.125, vatPercent: 25 }] };
  const xml = buildInvoice(inv);
  assert.match(xml, /<cbc:PriceAmount currencyID="NOK">0\.125<\/cbc:PriceAmount>/);
  assert.match(xml, /<cbc:LineExtensionAmount currencyID="NOK">1\.00<\/cbc:LineExtensionAmount>/);
  // whole-cent inputs stay byte-identical to the old money() formatting
  const xml2 = buildInvoice(sample);
  assert.match(xml2, /<cbc:PriceAmount currencyID="NOK">20000\.00<\/cbc:PriceAmount>/);
  assert.match(xml2, /<cbc:PriceAmount currencyID="NOK">1500\.00<\/cbc:PriceAmount>/);
});
