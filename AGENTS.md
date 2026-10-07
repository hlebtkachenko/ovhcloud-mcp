# AGENTS.md

MCP server for the OVHcloud API (VPS, domains and DNS, billing, API explorer, raw calls) plus SSH command execution. TypeScript, Node 22+, stdio transport. Layout and design: [ARCHITECTURE.md](ARCHITECTURE.md).

## Commands

```bash
npm ci
npm run build            # tsc -> dist/
npm test                 # build + node:test suite (fake OVH API and SSH server, no credentials)
npm run check:contract   # validate every tool's OVH request against OVH's published API schemas
```

## Rules

- Any change to a request a tool sends must pass `npm run check:contract`. Look up paths, methods and parameter names in the OVH schemas (`.spec-cache/` after the first run, or `https://eu.api.ovh.com/v1/<api>.json`), not in memory.
- Build API paths with the `apiPath` tagged template so every parameter is encoded as one segment.
- Every tool gets MCP annotations; writes report errors through `errorResult(err, "<read tool>")` so a timed-out write names the tool to verify with.
- New tools: one area per file in `src/tools/`, register in `src/index.ts`, add a test in `test/` and a row in the README tools table.
- Synthetic data only in tests and docs: `example.com`, `192.0.2.x`, placeholder IDs. No real hostnames, accounts or bills.
- Never commit credentials; configuration is env-only. Keep the README tool tables and env tables in sync with the code.
