# ehf-helper — CLAUDE.md

## What this repo is

A zero-dependency Node.js ES module that converts a plain invoice JSON into a
Peppol BIS Billing 3.0 (EN 16931 / EHF) UBL XML string. Single source file:
`src/ehf.js` exposing `buildInvoice(inv)` and `summarize(inv)`. Tests live in
`test/ehf.test.js` using Node's built-in test runner.

## Stack

- Runtime: Node.js >= 18 (no npm install needed — zero third-party deps)
- Tests: `node:test` + `node:assert/strict` (built-in)
- CI: GitHub Actions (`.github/workflows/ci.yml`), Node 20, `node --test`

## How to run / test

```bash
node --test          # runs all tests in test/
```

No build step. No install step. Copy `src/ehf.js` directly into a project if
preferred over cloning.

## Machine rules (this dev box — bergv, Windows 11)

- **WINDOWLESS**: never open a visible console window. Run Python scripts with
  `pythonw.exe`, not `python.exe`. Prefer Read/Glob/Grep/Edit/Write tools over
  Bash/PowerShell.
- **Python interpreter**: `C:/Users/bergv/AppData/Local/Programs/Python/Python312/python.exe`
  (use `pythonw.exe` sibling for windowless execution).
- **Secrets**: stored in `.env` (gitignored). Do not commit any `.env` file.
- This box is a dev clone — not the production host.
