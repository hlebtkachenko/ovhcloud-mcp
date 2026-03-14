# Changelog

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
- Comprehensive test suite

## [1.0.0] - 2026-03-14

### Added
- Initial release
- VPS management tools
- Domain and DNS tools
- Account and billing tools
- API key authentication (SHA1-HMAC)
