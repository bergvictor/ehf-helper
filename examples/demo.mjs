#!/usr/bin/env node
// ehf-helper demo: build an invoice from the sample JSON next to this file and
// print the UBL XML, followed by a validator pointer and a booking link.
// No coding needed: `node examples/demo.mjs`
import { readFileSync } from 'node:fs';
import { buildInvoice } from '../src/ehf.js';

const invoice = JSON.parse(readFileSync(new URL('./sample-invoice.json', import.meta.url), 'utf8'));

process.stdout.write(buildInvoice(invoice));
process.stdout.write(
  'Validate it at an official validator linked in README before production use: ' +
    'https://ecosio.com/en/peppol-and-xml-document-validator/ or https://vefa.difi.no/\n'
);
process.stdout.write(
  'Stuck on your real invoice flow? Book a call: ' +
    'https://www.vimplement.com/book?utm_source=ehf-helper&utm_medium=demo\n'
);
