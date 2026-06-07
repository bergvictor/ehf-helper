// ehf-helper — generate Peppol BIS Billing 3.0 (EN 16931 / EHF) UBL invoice XML
// from a simple JSON input. Pure and dependency-free.
//
// Scope: covers the common Norwegian domestic case — standard/reduced/zero VAT
// rates, a single document currency, supplier + customer parties, and invoice
// lines. It is NOT a certified generator: always validate the output with an
// official Peppol/EN16931 validator before sending in production.

/**
 * @typedef {Object} Address
 * @property {string} [street]
 * @property {string} [city]
 * @property {string} [postalZone]
 * @property {string} [country] ISO 3166-1 alpha-2 (default "NO")
 *
 * @typedef {Object} Party
 * @property {string} name        Registered legal name
 * @property {string} orgNo       Organisation number (Enhetsregisteret, scheme 0192)
 * @property {string} [vatNo]     e.g. "NO934134176MVA"
 * @property {Address} [address]
 *
 * @typedef {Object} Line
 * @property {string} name
 * @property {number} quantity
 * @property {number} unitPrice   Price per unit, ex. VAT
 * @property {number} vatPercent  e.g. 25, 15, 12, 0
 * @property {string} [unitCode]  UN/ECE Rec 20 code (default "EA")
 *
 * @typedef {Object} Invoice
 * @property {string} invoiceNumber
 * @property {string} issueDate   ISO date "YYYY-MM-DD"
 * @property {string} [dueDate]   ISO date "YYYY-MM-DD"
 * @property {string} [currency]  default "NOK"
 * @property {string} [note]
 * @property {Party} supplier
 * @property {Party} customer
 * @property {Line[]} lines
 */

const NS =
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';

const ORG_SCHEME = '0192'; // Norwegian organisation number

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(n) {
  return round2(n).toFixed(2);
}

function addressXml(a) {
  if (!a) return '';
  return (
    '\n      <cac:PostalAddress>' +
    (a.street ? `\n        <cbc:StreetName>${esc(a.street)}</cbc:StreetName>` : '') +
    (a.city ? `\n        <cbc:CityName>${esc(a.city)}</cbc:CityName>` : '') +
    (a.postalZone ? `\n        <cbc:PostalZone>${esc(a.postalZone)}</cbc:PostalZone>` : '') +
    `\n        <cac:Country><cbc:IdentificationCode>${esc(a.country || 'NO')}</cbc:IdentificationCode></cac:Country>` +
    '\n      </cac:PostalAddress>'
  );
}

function partyXml(p) {
  if (!p || !p.name || !p.orgNo) throw new Error('party requires name and orgNo');
  return (
    '\n      <cac:Party>' +
    `\n      <cbc:EndpointID schemeID="${ORG_SCHEME}">${esc(p.orgNo)}</cbc:EndpointID>` +
    addressXml(p.address) +
    (p.vatNo
      ? '\n      <cac:PartyTaxScheme>' +
        `\n        <cbc:CompanyID>${esc(p.vatNo)}</cbc:CompanyID>` +
        '\n        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>' +
        '\n      </cac:PartyTaxScheme>'
      : '') +
    '\n      <cac:PartyLegalEntity>' +
    `\n        <cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>` +
    `\n        <cbc:CompanyID schemeID="${ORG_SCHEME}">${esc(p.orgNo)}</cbc:CompanyID>` +
    '\n      </cac:PartyLegalEntity>' +
    '\n      </cac:Party>'
  );
}

/**
 * Compute monetary totals for an invoice (ex VAT, VAT, inc VAT) plus the
 * per-rate VAT breakdown. Useful on its own for dashboards/checks.
 * @param {Invoice} inv
 */
export function summarize(inv) {
  if (!inv || !Array.isArray(inv.lines) || inv.lines.length === 0) {
    throw new Error('at least one line is required');
  }
  const lines = inv.lines.map((l) => ({
    ...l,
    lineAmount: round2(Number(l.quantity) * Number(l.unitPrice)),
    vat: Number(l.vatPercent),
  }));
  const net = round2(lines.reduce((s, l) => s + l.lineAmount, 0));
  const groups = new Map();
  for (const l of lines) {
    const g = groups.get(l.vat) || { percent: l.vat, taxable: 0 };
    g.taxable = round2(g.taxable + l.lineAmount);
    groups.set(l.vat, g);
  }
  let vat = 0;
  const breakdown = [...groups.values()]
    .sort((a, b) => b.percent - a.percent)
    .map((g) => {
      const taxAmount = round2((g.taxable * g.percent) / 100);
      vat = round2(vat + taxAmount);
      return { percent: g.percent, taxable: g.taxable, taxAmount };
    });
  return { net, vat, gross: round2(net + vat), breakdown, lines };
}

/**
 * Build a Peppol BIS Billing 3.0 UBL Invoice XML string.
 * @param {Invoice} inv
 * @returns {string}
 */
export function buildInvoice(inv) {
  if (!inv || !inv.invoiceNumber) throw new Error('invoiceNumber is required');
  if (!inv.issueDate) throw new Error('issueDate is required');
  const currency = inv.currency || 'NOK';
  const { net, vat, gross, breakdown, lines } = summarize(inv);

  const subtotalsXml = breakdown
    .map((g) => {
      const catId = g.percent > 0 ? 'S' : 'Z';
      return (
        '\n    <cac:TaxSubtotal>' +
        `\n      <cbc:TaxableAmount currencyID="${currency}">${money(g.taxable)}</cbc:TaxableAmount>` +
        `\n      <cbc:TaxAmount currencyID="${currency}">${money(g.taxAmount)}</cbc:TaxAmount>` +
        '\n      <cac:TaxCategory>' +
        `\n        <cbc:ID>${catId}</cbc:ID>` +
        `\n        <cbc:Percent>${g.percent.toFixed(2)}</cbc:Percent>` +
        '\n        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>' +
        '\n      </cac:TaxCategory>' +
        '\n    </cac:TaxSubtotal>'
      );
    })
    .join('');

  const linesXml = lines
    .map((l, i) => {
      const catId = l.vat > 0 ? 'S' : 'Z';
      const unitCode = esc(l.unitCode || 'EA');
      return (
        '\n  <cac:InvoiceLine>' +
        `\n    <cbc:ID>${i + 1}</cbc:ID>` +
        `\n    <cbc:InvoicedQuantity unitCode="${unitCode}">${Number(l.quantity)}</cbc:InvoicedQuantity>` +
        `\n    <cbc:LineExtensionAmount currencyID="${currency}">${money(l.lineAmount)}</cbc:LineExtensionAmount>` +
        '\n    <cac:Item>' +
        `\n      <cbc:Name>${esc(l.name)}</cbc:Name>` +
        '\n      <cac:ClassifiedTaxCategory>' +
        `\n        <cbc:ID>${catId}</cbc:ID>` +
        `\n        <cbc:Percent>${l.vat.toFixed(2)}</cbc:Percent>` +
        '\n        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>' +
        '\n      </cac:ClassifiedTaxCategory>' +
        '\n    </cac:Item>' +
        `\n    <cac:Price><cbc:PriceAmount currencyID="${currency}">${money(l.unitPrice)}</cbc:PriceAmount></cac:Price>` +
        '\n  </cac:InvoiceLine>'
      );
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<Invoice ${NS}>\n` +
    '  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>\n' +
    '  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>\n' +
    `  <cbc:ID>${esc(inv.invoiceNumber)}</cbc:ID>\n` +
    `  <cbc:IssueDate>${esc(inv.issueDate)}</cbc:IssueDate>\n` +
    (inv.dueDate ? `  <cbc:DueDate>${esc(inv.dueDate)}</cbc:DueDate>\n` : '') +
    '  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>\n' +
    (inv.note ? `  <cbc:Note>${esc(inv.note)}</cbc:Note>\n` : '') +
    `  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>\n` +
    `  <cac:AccountingSupplierParty>${partyXml(inv.supplier)}\n  </cac:AccountingSupplierParty>\n` +
    `  <cac:AccountingCustomerParty>${partyXml(inv.customer)}\n  </cac:AccountingCustomerParty>\n` +
    '  <cac:TaxTotal>\n' +
    `    <cbc:TaxAmount currencyID="${currency}">${money(vat)}</cbc:TaxAmount>` +
    subtotalsXml +
    '\n  </cac:TaxTotal>\n' +
    '  <cac:LegalMonetaryTotal>\n' +
    `    <cbc:LineExtensionAmount currencyID="${currency}">${money(net)}</cbc:LineExtensionAmount>\n` +
    `    <cbc:TaxExclusiveAmount currencyID="${currency}">${money(net)}</cbc:TaxExclusiveAmount>\n` +
    `    <cbc:TaxInclusiveAmount currencyID="${currency}">${money(gross)}</cbc:TaxInclusiveAmount>\n` +
    `    <cbc:PayableAmount currencyID="${currency}">${money(gross)}</cbc:PayableAmount>\n` +
    '  </cac:LegalMonetaryTotal>' +
    linesXml +
    '\n</Invoice>\n'
  );
}

export default { buildInvoice, summarize };
