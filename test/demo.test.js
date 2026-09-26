import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const demoPath = fileURLToPath(new URL('../examples/demo.mjs', import.meta.url));
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('demo prints UBL XML plus validator and booking lines', () => {
  const out = execFileSync(process.execPath, [demoPath], { encoding: 'utf8' });
  assert.match(out, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(out, /<Invoice[\s>]/);
  assert.match(out, /<\/Invoice>/);
  // the validator URLs the demo prints must also be linked in README
  for (const url of [
    'https://ecosio.com/en/peppol-and-xml-document-validator/',
    'https://vefa.difi.no/',
  ]) {
    assert.ok(readme.includes(url), `README links ${url}`);
    assert.ok(out.includes(url), `demo prints ${url}`);
  }
  assert.ok(
    out.includes(
      'Stuck on your real invoice flow? Book a call: ' +
        'https://www.vimplement.com/book?utm_source=ehf-helper&utm_medium=demo'
    ),
    'demo prints the booking line'
  );
});
