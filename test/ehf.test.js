import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoice, summarize } from '../src/ehf.js';

const sample = {
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
  assert.match(xml, /<cbc:EndpointID schemeID="0192">934134176<\/cbc:EndpointID>/);
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

test('rejects invalid input', () => {
  assert.throws(() => buildInvoice({ lines: [] }), /invoiceNumber/);
  assert.throws(() => buildInvoice({ invoiceNumber: 'x', issueDate: '2026-01-01', lines: [] }), /at least one line/);
});
