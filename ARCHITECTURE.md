# Architecture

## Structure

```
src/
  index.ts              Entry point: auth mode detection from env, tool registration
  ovh-client.ts         OVH API client (SHA1-HMAC API keys or OAuth2 client credentials), path validation, time sync
  tools/
    utils.ts            Result helpers, apiPath (encoded path segments), annotation presets
    vps.ts              VPS (9 tools)
    domain.ts           Domains and DNS (8 tools)
    account.ts          Account, services, invoices (4 tools)
    explorer.ts         Search OVH's published API schemas (3 tools)
    raw.ts              Raw API call (1 tool)
    ssh.ts              SSH command execution (2 tools)
test/                   node:test suite: dist/ against a fake OVH API (fake-ovh.mjs) and an in-process ssh2 server
scripts/check-contract.mjs  Validates every tool's requests against https://eu.api.ovh.com/v1/{api}.json
```

## Flow

```
MCP client --stdio--> tool handler --apiPath--> OvhClient.request --HTTPS--> OVH API
                           ^                                                    |
                           +------ JSON / OvhApiError (status) <----------------+
```

## Design notes

- **Schema is the contract.** OVH publishes a JSON schema per API (`vps.json`, `domain.json`, `me.json`, `services.json`). `npm run check:contract` calls every OVH tool twice (all fields, required fields only) and checks method, path, parameter names, numeric types, enum values and body fields. SSH, explorer and raw tools are skipped.
- **Errors**: `OvhClient` throws `OvhApiError` with the HTTP status on any non-2xx answer; tools turn it into `isError`. Only documented "not found" cases (no snapshot, bill without details) treat 404 as an empty result. A non-GET request that times out is reported as "outcome unknown" with the read tool to verify with; nothing is retried.
- **Paths**: `validatePath` rejects `..`, `?`, `#` and `\` before and after percent-decoding; `apiPath` encodes each parameter as one segment.
- **Writes after writes**: DNS create/update/delete refresh the zone afterwards; a failed refresh is an error that says the record change itself was saved.
- **Raw API**: `ovh_api_raw` is GET-only unless `OVH_ALLOW_RAW_WRITES=true`.
- **SSH**: env credentials and the `SSH_HOST_KEY` pin apply only to `SSH_HOST`; any other host needs explicit credentials and is unverified. The key path comes only from env.
- **Not in OVH's public schema**: VPS CPU and network statistics (only per-disk monitoring is documented).
