# Changelog

## [3.0.0] - 2026-10-07

### Breaking
- `ovh_vps_monitoring` returns per-disk statistics from the documented `/vps/{serviceName}/disks/{id}/monitoring` (`type`: `used`|`max`, optional `diskId`, `period` adds `today`). The old `/vps/{serviceName}/use` call is not in OVH's schema; VPS CPU and network statistics are not available.
- `ovh_api_raw` sends POST/PUT/DELETE only with `OVH_ALLOW_RAW_WRITES=true`.
- SSH: `privateKeyFile` parameter removed (key path only from `SSH_PRIVATE_KEY_FILE`); env credentials are used only for `SSH_HOST`.
- OAuth2 with a custom `OVH_ENDPOINT` URL is refused.
- `ovh_invoices` lists bills in a date range (`from`/`to`, default last 365 days).
- Node.js 22+ required.

### Fixed
- `ovh_api_search` / `ovh_api_endpoint_detail` fetch `{category}.json` (they got 401 before) and report schema fetch failures instead of "no matches".
- `ovh_services` uses `GET /services` and `/services/{serviceId}` (`/me/service` does not exist).
- OAuth2 access token URL and `scope=all` match go-ovh.
- RAM read from `vps.Model.memory`.
- `ovh_vps_snapshot` treats only 404 as "no snapshot".
- DNS writes report a failed zone refresh separately from the saved change.
- Percent-encoded traversal (`%2e%2e`) rejected; tool path parameters are encoded.
- Failed `/auth/time` no longer caches NaN.
- `ovh_invoice_detail` leaves out the bill password; `ovh_invoices` sorts by bill date.
- SSH: optional `SSH_HOST_KEY` pin; non-zero exit, signal kill and failed `ovh_ssh_check` are errors.
- A write that times out reports "outcome unknown" with the read tool to check.

### Added
- MCP annotations on every tool.
- node:test suite against a fake OVH API and SSH server; `npm run check:contract` against OVH's published schemas; CI runs both.
- AGENTS.md, ARCHITECTURE.md.

## [2.0.1] - 2026-03-15

### Fixed
- Explorer tools now use the client's configured API endpoint instead of hardcoded EU URL
- Variable shadowing in domain.ts (loop variable `z` shadowed Zod import)
- Version duplication between package.json and index.ts

### Changed
- Moved `ovh_api_raw` tool from domain.ts to dedicated raw.ts
- Extracted SSH parameter resolution into `resolveSshConfig()` helper
- Shared `TIMEOUT_MS` constant between ovh-client.ts and explorer.ts
- Added `textResult` helper to reduce response boilerplate
- Added try/catch error handling with `isError` flag across all tool handlers

### Removed
- Dead `parseJson` function from account.ts

### Added
- CI workflow (GitHub Actions)
- Package metadata (author, repository, engines, keywords)
- README badges (license, node version, TypeScript)

## [2.0.0] - 2026-03-14

### Added
- OAuth2 service account authentication
- API explorer tools (catalog, search, endpoint detail)
- SSH tools (exec, connectivity check)
- Docker support with multi-stage build
- Jest tests for path validation and client construction

## [1.0.0] - 2026-03-14

### Added
- Initial release
- VPS management tools
- Domain and DNS tools
- Account and billing tools
- API key authentication (SHA1-HMAC)
