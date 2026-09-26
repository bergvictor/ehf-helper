// ehf-helper — generate Peppol BIS Billing 3.0 (EN 16931 / EHF) UBL invoice XML
// from a simple JSON input. Pure and dependency-free.
//
// Scope: covers the common Norwegian domestic case — standard/reduced/zero VAT
// rates, a single document currency, supplier + customer parties, and invoice
// lines. It is NOT a certified generator: always validate the output with an
// official Peppol/EN16931 validator before sending in production.
//
// Invalid inputs throw EhfValidationError naming the field and the rule.

/**
 * Error thrown for any invalid invoice input. The message always names the
 * offending field and the rule it violates.
 */
export class EhfValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EhfValidationError';
  }
}

/**
 * @typedef {Object} Address
 * @property {string} [street]
 * @property {string} [city]
 * @property {string} [postalZone]
 * @property {string} [country] ISO 3166-1 alpha-2 (default "NO")
 *
 * @typedef {Object} Party
 * @property {string} name        Registered legal name
 * @property {string} orgNo       9-digit Norwegian organisation number (Enhetsregisteret, scheme 0192)
 * @property {string} [vatNo]     e.g. "NO987654321MVA" — required for the supplier
 *                                (seller VAT identifier, BT-31; EN 16931 rule BR-S-02),
 *                                optional for the customer
 * @property {Address} [address]
 *
 * @typedef {Object} Line
 * @property {string} name
 * @property {number} quantity
 * @property {number} unitPrice   Price per unit, ex. VAT
 * @property {number} vatPercent  e.g. 25, 15, 12, 0
 * @property {string} [unitCode]  UN/ECE Rec 20 code (default "EA")
 * @property {string} [vatCategory] UNCL 5305 VAT category: S, Z, E, AE, K, G or O.
 *                                Default keeps the historical behaviour: "S" when
 *                                vatPercent > 0, otherwise "Z".
 * @property {string} [vatExemptionReason] Free-text exemption reason (BT-121).
 *                                Required for E and AE, allowed for K, G and O,
 *                                must be omitted for S and Z.
 *
 * @typedef {Object} Payment
 * @property {string} account          Payee account number (Norwegian BBAN or IBAN)
 * @property {string|number} [meansCode] UN/ECE 4461 payment means code (default "30", credit transfer)
 * @property {string} [kid]            Norwegian KID / remittance reference (emitted as cbc:PaymentID)
 * @property {string} [accountName]    Account holder name
 * @property {string} [bic]            BIC/SWIFT of the payee's bank
 *
 * @typedef {Object} Invoice
 * @property {string} invoiceNumber
 * @property {string} issueDate   ISO calendar date "YYYY-MM-DD"
 * @property {string} buyerReference Buyer's reference (BT-10) — required by Peppol BIS 3.0
 * @property {string} [dueDate]   ISO calendar date "YYYY-MM-DD"
 * @property {string} [currency]  3-letter ISO 4217 code (default "NOK")
 * @property {string} [note]
 * @property {Party} supplier     Must carry vatNo (BT-31, EN 16931 rule BR-S-02)
 * @property {Party} customer
 * @property {Payment} [payment]  Emitted as cac:PaymentMeans when present
 * @property {Line[]} lines
 */

const NS =
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';

const ORG_SCHEME = '0192'; // Norwegian organisation number

const ORG_NO_RE = /^\d{9}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

// UNCL 5305 VAT category subset used by Peppol BIS Billing 3.0 (BT-118/BT-151).
const VAT_CATEGORY_INFO = {
  S: 'standard rated',
  Z: 'zero rated',
  E: 'exempt from VAT',
  AE: 'reverse charge',
  K: 'intra-community supply',
  G: 'export outside the EU',
  O: 'outside scope of VAT',
};
const VAT_CATEGORIES = new Set(Object.keys(VAT_CATEGORY_INFO));
const REASON_REQUIRED_CATEGORIES = new Set(['E', 'AE']);
const REASON_FORBIDDEN_CATEGORIES = new Set(['S', 'Z']);

// C0 controls (except tab/LF/CR), DEL, C1 controls, and lone (unpaired) surrogates
// are all invalid in XML 1.0 and will make strict Peppol access-point parsers reject
// the document. The surrogate alternatives are pair-aware so valid surrogate pairs
// (e.g. emoji) are left untouched.
const XML_ILLEGAL_RE =
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(XML_ILLEGAL_RE, '');
}

function isLeapYear(y) {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function assertIsoDate(value, field) {
  const m = ISO_DATE_RE.exec(String(value));
  let ok = false;
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const dim = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    ok = month >= 1 && month <= 12 && day >= 1 && day <= dim[month - 1];
  }
  if (!ok) {
    throw new EhfValidationError(
      `${field} must be a real calendar date in ISO format YYYY-MM-DD; got ${JSON.stringify(value)}`
    );
  }
}

function assertCurrency(value) {
  if (!CURRENCY_RE.test(String(value))) {
    throw new EhfValidationError(
      `currency must be a 3-letter ISO 4217 code (e.g. "NOK"); got ${JSON.stringify(value)}`
    );
  }
}

function assertParty(p, label) {
  if (!p) {
    throw new EhfValidationError(`${label} is required: provide name and 9-digit orgNo`);
  }
  if (p.name == null || String(p.name).trim() === '') {
    throw new EhfValidationError(`${label}.name is required: registered legal name`);
  }
  if (p.orgNo == null || String(p.orgNo).trim() === '') {
    throw new EhfValidationError(
      `${label}.orgNo is required: 9-digit Norwegian organisation number (endpoint scheme 0192)`
    );
  }
  if (!ORG_NO_RE.test(String(p.orgNo))) {
    throw new EhfValidationError(
      `${label}.orgNo must be a 9-digit Norwegian organisation number ` +
        `(endpoint scheme 0192); got ${JSON.stringify(p.orgNo)}`
    );
  }
}

function assertSupplierVatId(supplier) {
  const vatNo = supplier && supplier.vatNo;
  if (vatNo == null || String(vatNo).trim() === '') {
    throw new EhfValidationError(
      'supplier.vatNo is required: the seller VAT identifier (BT-31) is mandatory under ' +
        'Peppol BIS Billing 3.0 (EN 16931 rule BR-S-02 requires BT-31, BT-32 or BT-63 on ' +
        'invoices with standard-rated lines); e.g. "NO987654321MVA"'
    );
  }
}

/**
 * Resolve and validate a line's VAT category. Defaults preserve the historical
 * behaviour ("S" when vatPercent > 0, otherwise "Z"); an explicit vatCategory
 * is checked against its rate and exemption-reason combination.
 */
function resolveLineCategory(l, i, vatPercent) {
  const raw = l.vatCategory;
  const category = raw == null ? (vatPercent > 0 ? 'S' : 'Z') : String(raw);
  if (!VAT_CATEGORIES.has(category)) {
    throw new EhfValidationError(
      `line ${i}: vatCategory must be one of ${[...VAT_CATEGORIES].join(', ')} ` +
        `(UNCL 5305 VAT category); got ${JSON.stringify(raw)}`
    );
  }
  const desc = VAT_CATEGORY_INFO[category];
  if (category === 'S') {
    if (!(vatPercent > 0)) {
      throw new EhfValidationError(
        `line ${i}: vatCategory "S" (${desc}) requires vatPercent > 0; got ${vatPercent}`
      );
    }
  } else if (vatPercent !== 0) {
    throw new EhfValidationError(
      `line ${i}: vatCategory "${category}" (${desc}) requires vatPercent 0; got ${vatPercent}`
    );
  }
  const rawReason = l.vatExemptionReason;
  const reason = rawReason == null || String(rawReason).trim() === '' ? null : String(rawReason);
  if (reason === null && REASON_REQUIRED_CATEGORIES.has(category)) {
    throw new EhfValidationError(
      `line ${i}: vatCategory "${category}" (${desc}) requires vatPercent 0 and a ` +
        `vatExemptionReason (BT-121, e.g. "Reverse charge")`
    );
  }
  if (reason !== null && REASON_FORBIDDEN_CATEGORIES.has(category)) {
    throw new EhfValidationError(
      `line ${i}: vatExemptionReason must be omitted when vatCategory is "${category}" ` +
        `(exemption reasons apply to E, AE, K, G, O)`
    );
  }
  return { category, exemptionReason: reason };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(n) {
  return round2(n).toFixed(2);
}

function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Format a quantity as an xs:decimal-safe string: no scientific notation.
 * Integers render as-is; non-integers use a fixed-point expansion with
 * trailing zeros trimmed. Magnitudes >= 1e21 can't be represented without
 * falling back to exponential notation, so they're rejected instead.
 */
function formatQuantity(n) {
  if (!Number.isFinite(n)) throw new EhfValidationError('quantity is not a finite number');
  if (Math.abs(n) >= 1e21) {
    throw new EhfValidationError('quantity magnitude is too large to represent as xs:decimal');
  }
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Format a unit price with up to 4 decimal places (trailing zeros trimmed,
 * minimum 2 decimals) so sub-cent unit prices survive the EN 16931
 * price x quantity = lineExtensionAmount validation.
 */
function price(n) {
  let s = round4(n).toFixed(4).replace(/0+$/, '');
  if (s.endsWith('.')) return s + '00';
  const decimals = s.split('.')[1].length;
  return decimals < 2 ? s + '0'.repeat(2 - decimals) : s;
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

function partyXml(p, label = 'party') {
  assertParty(p, label);
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

function paymentMeansXml(p) {
  if (!p) return '';
  if (!p.account) throw new EhfValidationError('payment requires account');
  const code = p.meansCode == null ? '30' : String(p.meansCode);
  return (
    '  <cac:PaymentMeans>\n' +
    `    <cbc:PaymentMeansCode>${esc(code)}</cbc:PaymentMeansCode>\n` +
    (p.kid ? `    <cbc:PaymentID>${esc(p.kid)}</cbc:PaymentID>\n` : '') +
    '    <cac:PayeeFinancialAccount>\n' +
    `      <cbc:ID>${esc(p.account)}</cbc:ID>\n` +
    (p.accountName ? `      <cbc:Name>${esc(p.accountName)}</cbc:Name>\n` : '') +
    (p.bic
      ? `      <cac:FinancialInstitutionBranch><cbc:ID>${esc(p.bic)}</cbc:ID></cac:FinancialInstitutionBranch>\n`
      : '') +
    '    </cac:PayeeFinancialAccount>\n' +
    '  </cac:PaymentMeans>\n'
  );
}

/**
 * Compute monetary totals for an invoice (ex VAT, VAT, inc VAT) plus the
 * per-rate VAT breakdown. Useful on its own for dashboards/checks.
 * @param {Invoice} inv
 */
export function summarize(inv) {
  if (!inv || !Array.isArray(inv.lines) || inv.lines.length === 0) {
    throw new EhfValidationError('at least one line is required');
  }
  const lines = inv.lines.map((l, i) => {
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice);
    const vatPercent = Number(l.vatPercent);
    if (!Number.isFinite(quantity)) {
      throw new EhfValidationError(`line ${i}: quantity is not a finite number`);
    }
    if (!Number.isFinite(unitPrice)) {
      throw new EhfValidationError(`line ${i}: unitPrice is not a finite number`);
    }
    if (!Number.isFinite(vatPercent)) {
      throw new EhfValidationError(`line ${i}: vatPercent is not a finite number`);
    }
    const { category, exemptionReason } = resolveLineCategory(l, i, vatPercent);
    return {
      ...l,
      lineAmount: round2(quantity * unitPrice),
      vat: vatPercent,
      category,
      exemptionReason,
    };
  });
  const net = round2(lines.reduce((s, l) => s + l.lineAmount, 0));
  const groups = new Map();
  for (const l of lines) {
    // Lines sharing a category, rate and exemption reason share a TaxSubtotal.
    const key = `${l.category}\n${l.vat}\n${l.exemptionReason || ''}`;
    const g = groups.get(key) || {
      percent: l.vat,
      category: l.category,
      exemptionReason: l.exemptionReason,
      taxable: 0,
    };
    g.taxable = round2(g.taxable + l.lineAmount);
    groups.set(key, g);
  }
  let vat = 0;
  const breakdown = [...groups.values()]
    .sort((a, b) => b.percent - a.percent || (a.category < b.category ? -1 : 1))
    .map((g) => {
      const taxAmount = round2((g.taxable * g.percent) / 100);
      vat = round2(vat + taxAmount);
      return {
        percent: g.percent,
        category: g.category,
        taxable: g.taxable,
        taxAmount,
        exemptionReason: g.exemptionReason,
      };
    });
  return { net, vat, gross: round2(net + vat), breakdown, lines };
}

/**
 * Build a Peppol BIS Billing 3.0 UBL Invoice XML string.
 * @param {Invoice} inv
 * @returns {string}
 */
export function buildInvoice(inv) {
  if (!inv || !inv.invoiceNumber) throw new EhfValidationError('invoiceNumber is required');
  if (!inv.issueDate) throw new EhfValidationError('issueDate is required');
  if (!inv.buyerReference) {
    throw new EhfValidationError('buyerReference is required (BT-10, Peppol BIS 3.0 rule PEPPOL-EN16931-R003)');
  }
  assertIsoDate(inv.issueDate, 'issueDate');
  if (inv.dueDate != null) assertIsoDate(inv.dueDate, 'dueDate');
  const currency = inv.currency == null ? 'NOK' : inv.currency;
  assertCurrency(currency);
  if (!Array.isArray(inv.lines) || inv.lines.length === 0) {
    throw new EhfValidationError('at least one line is required');
  }
  assertParty(inv.supplier, 'supplier');
  assertSupplierVatId(inv.supplier);
  assertParty(inv.customer, 'customer');
  const { net, vat, gross, breakdown, lines } = summarize(inv);
  const cur = esc(currency);

  const subtotalsXml = breakdown
    .map((g) => {
      return (
        '\n    <cac:TaxSubtotal>' +
        `\n      <cbc:TaxableAmount currencyID="${cur}">${money(g.taxable)}</cbc:TaxableAmount>` +
        `\n      <cbc:TaxAmount currencyID="${cur}">${money(g.taxAmount)}</cbc:TaxAmount>` +
        '\n      <cac:TaxCategory>' +
        `\n        <cbc:ID>${g.category}</cbc:ID>` +
        `\n        <cbc:Percent>${g.percent.toFixed(2)}</cbc:Percent>` +
        // UBL 2.1 TaxCategory sequence: ID, Percent, TaxExemptionReason (BT-120), TaxScheme.
        // TaxSubtotal itself has no TaxExemptionReason element.
        (g.exemptionReason
          ? `\n        <cbc:TaxExemptionReason>${esc(g.exemptionReason)}</cbc:TaxExemptionReason>`
          : '') +
        '\n        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>' +
        '\n      </cac:TaxCategory>' +
        '\n    </cac:TaxSubtotal>'
      );
    })
    .join('');

  const linesXml = lines
    .map((l, i) => {
      const unitCode = esc(l.unitCode || 'EA');
      return (
        '\n  <cac:InvoiceLine>' +
        `\n    <cbc:ID>${i + 1}</cbc:ID>` +
        `\n    <cbc:InvoicedQuantity unitCode="${unitCode}">${formatQuantity(Number(l.quantity))}</cbc:InvoicedQuantity>` +
        `\n    <cbc:LineExtensionAmount currencyID="${cur}">${money(l.lineAmount)}</cbc:LineExtensionAmount>` +
        '\n    <cac:Item>' +
        `\n      <cbc:Name>${esc(l.name)}</cbc:Name>` +
        '\n      <cac:ClassifiedTaxCategory>' +
        `\n        <cbc:ID>${l.category}</cbc:ID>` +
        `\n        <cbc:Percent>${l.vat.toFixed(2)}</cbc:Percent>` +
        '\n        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>' +
        '\n      </cac:ClassifiedTaxCategory>' +
        '\n    </cac:Item>' +
        `\n    <cac:Price><cbc:PriceAmount currencyID="${cur}">${price(Number(l.unitPrice))}</cbc:PriceAmount></cac:Price>` +
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
    `  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>\n` +
    `  <cbc:BuyerReference>${esc(inv.buyerReference)}</cbc:BuyerReference>\n` +
    `  <cac:AccountingSupplierParty>${partyXml(inv.supplier, 'supplier')}\n  </cac:AccountingSupplierParty>\n` +
    `  <cac:AccountingCustomerParty>${partyXml(inv.customer, 'customer')}\n  </cac:AccountingCustomerParty>\n` +
    paymentMeansXml(inv.payment) +
    '  <cac:TaxTotal>\n' +
    `    <cbc:TaxAmount currencyID="${cur}">${money(vat)}</cbc:TaxAmount>` +
    subtotalsXml +
    '\n  </cac:TaxTotal>\n' +
    '  <cac:LegalMonetaryTotal>\n' +
    `    <cbc:LineExtensionAmount currencyID="${cur}">${money(net)}</cbc:LineExtensionAmount>\n` +
    `    <cbc:TaxExclusiveAmount currencyID="${cur}">${money(net)}</cbc:TaxExclusiveAmount>\n` +
    `    <cbc:TaxInclusiveAmount currencyID="${cur}">${money(gross)}</cbc:TaxInclusiveAmount>\n` +
    `    <cbc:PayableAmount currencyID="${cur}">${money(gross)}</cbc:PayableAmount>\n` +
    '  </cac:LegalMonetaryTotal>' +
    linesXml +
    '\n</Invoice>\n'
  );
}

export default { buildInvoice, summarize, EhfValidationError };
