# OVHcloud MCP Server

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-7-blue)

MCP server for [OVHcloud](https://www.ovhcloud.com). Manage VPS, domains, DNS, billing, and execute SSH commands from any MCP-compatible client.

27 tools, plus search over OVH's published API schemas and a raw API call for anything not covered.

## Requirements

- Node.js 22+
- OVH API credentials ([create token](https://www.ovh.com/auth/api/createToken))

## Installation

```bash
git clone https://github.com/hlebtkachenko/ovhcloud-mcp.git
cd ovhcloud-mcp
npm ci
npm run build
```

## Configuration

### Cursor

`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "ovhcloud": {
      "command": "node",
      "args": ["/path/to/ovhcloud-mcp/dist/index.js"],
      "env": {
        "OVH_APPLICATION_KEY": "your_app_key",
        "OVH_APPLICATION_SECRET": "your_app_secret",
        "OVH_CONSUMER_KEY": "your_consumer_key"
      }
    }
  }
}
```

### Claude Desktop

`claude_desktop_config.json` ([location](https://modelcontextprotocol.io/quickstart/user#1-open-your-mcp-client))

```json
{
  "mcpServers": {
    "ovhcloud": {
      "command": "node",
      "args": ["/path/to/ovhcloud-mcp/dist/index.js"],
      "env": {
        "OVH_APPLICATION_KEY": "your_app_key",
        "OVH_APPLICATION_SECRET": "your_app_secret",
        "OVH_CONSUMER_KEY": "your_consumer_key"
      }
    }
  }
}
```

### Claude Code

`.mcp.json` in your project root, or `~/.claude.json` globally:

```json
{
  "mcpServers": {
    "ovhcloud": {
      "command": "node",
      "args": ["/path/to/ovhcloud-mcp/dist/index.js"],
      "env": {
        "OVH_APPLICATION_KEY": "your_app_key",
        "OVH_APPLICATION_SECRET": "your_app_secret",
        "OVH_CONSUMER_KEY": "your_consumer_key"
      }
    }
  }
}
```

### Any MCP client (stdio)

The server uses `stdio` transport. Point your MCP client to:

```
node /path/to/ovhcloud-mcp/dist/index.js
```

With environment variables set for authentication (see below).

### Environment Variables

**Authentication** (one of two modes, auto-detected):

| Variable | Mode | Description |
|----------|------|-------------|
| `OVH_APPLICATION_KEY` | API key | Application key |
| `OVH_APPLICATION_SECRET` | API key | Application secret |
| `OVH_CONSUMER_KEY` | API key | Consumer key |
| `OVH_CLIENT_ID` | OAuth2 | Service account ID |
| `OVH_CLIENT_SECRET` | OAuth2 | Service account secret |
| `OVH_ENDPOINT` | Both | `ovh-eu` (default), `ovh-ca`, `ovh-us`, or a custom API base URL (API key mode only) |

OAuth2 gets its access token the same way as [go-ovh](https://github.com/ovh/go-ovh): client credentials with `scope=all` from `https://www.ovh.com/auth/oauth2/token` (EU), `https://ca.ovh.com/auth/oauth2/token` (CA) or `https://us.ovhcloud.com/auth/oauth2/token` (US).

**Other** (optional):

| Variable | Description |
|----------|-------------|
| `OVH_ALLOW_RAW_WRITES` | `true` lets `ovh_api_raw` send POST, PUT and DELETE. Unset: GET only |
| `OVH_TIMEOUT_MS` | HTTP timeout per request (default 30000) |

**SSH** (optional):

| Variable | Description |
|----------|-------------|
| `SSH_HOST` | Default SSH host. The env credentials below are used only for this host |
| `SSH_PORT` | SSH port for `SSH_HOST` (default: 22) |
| `SSH_USER` | Username for `SSH_HOST` |
| `SSH_PASSWORD` | Password for `SSH_HOST` |
| `SSH_PRIVATE_KEY_FILE` | Private key file for `SSH_HOST` (takes precedence over `SSH_PASSWORD`) |
| `SSH_HOST_KEY` | Pinned host key fingerprint of `SSH_HOST`, as printed by `ssh-keygen -lf` (`SHA256:...`). The connection is refused on mismatch |

For any other host, the tool call must pass `username` and `password` itself. Without `SSH_HOST_KEY` (and always for other hosts) the host key is not verified; the result then carries a warning.

## Tools

### VPS

OVH's public API schema has no VPS CPU or network statistics, so `ovh_vps_monitoring` covers disks only.

| Tool | Description |
|------|-------------|
| `ovh_vps_list` | List all VPS with hardware details |
| `ovh_vps_info` | Server state, hardware, IPs, service status |
| `ovh_vps_monitoring` | Disk usage statistics (`used` or `max`) per disk and period |
| `ovh_vps_ips` | List assigned IPs |
| `ovh_vps_reboot` | Reboot a VPS |
| `ovh_vps_start` | Start a stopped VPS |
| `ovh_vps_stop` | Stop a running VPS |
| `ovh_vps_snapshot` | Get snapshot info |
| `ovh_vps_create_snapshot` | Create a snapshot (needs the snapshot option and no existing snapshot) |

### Domains & DNS

| Tool | Description |
|------|-------------|
| `ovh_domain_list` | List all domains and DNS zones |
| `ovh_domain_zone_info` | Nameservers, DNSSEC status |
| `ovh_domain_dns_records` | List records with type/subdomain filters |
| `ovh_domain_dns_record_detail` | Single record details |
| `ovh_domain_dns_create` | Create DNS record, then refresh the zone |
| `ovh_domain_dns_update` | Update DNS record, then refresh the zone |
| `ovh_domain_dns_delete` | Delete DNS record, then refresh the zone |
| `ovh_domain_dns_refresh` | Force zone refresh |

### Account & Billing

| Tool | Description |
|------|-------------|
| `ovh_account_info` | Account details (name, email, country) |
| `ovh_services` | All services with state, renewal mode and expiration (`/services`) |
| `ovh_invoices` | Invoices in a date range (default: last 365 days), newest first, with PDF links |
| `ovh_invoice_detail` | Invoice with line items (the bill password is left out) |

### API Explorer

Discover and inspect any OVH API endpoint without writing code.

| Tool | Description |
|------|-------------|
| `ovh_api_catalog` | List all API categories (vps, cloud, email, dedicated, etc.) |
| `ovh_api_search` | Search endpoints by keyword across all or specific categories |
| `ovh_api_endpoint_detail` | Parameters, types, and descriptions for any endpoint |

### SSH

| Tool | Description |
|------|-------------|
| `ovh_ssh_exec` | Execute a command on a remote server; non-zero exit or a signal is an error |
| `ovh_ssh_check` | Test SSH connectivity |

### Raw API

| Tool | Description |
|------|-------------|
| `ovh_api_raw` | Call any OVH API endpoint directly; POST/PUT/DELETE need `OVH_ALLOW_RAW_WRITES=true` |

## Docker

```bash
docker build -t ovhcloud-mcp .
docker run --rm \
  -e OVH_APPLICATION_KEY=... \
  -e OVH_APPLICATION_SECRET=... \
  -e OVH_CONSUMER_KEY=... \
  ovhcloud-mcp
```

Multi-stage build, runs as non-root `node` user.

## Security

- API paths are checked before every request: `..`, `?`, `#` and `\` are rejected, also when percent-encoded; tool parameters are encoded as single path segments
- `ovh_api_raw` is read-only unless `OVH_ALLOW_RAW_WRITES=true`
- SSH env credentials are sent only to `SSH_HOST`; `SSH_HOST_KEY` pins its host key
- A write that times out is reported as "outcome unknown" and never retried
- Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`)
- 30-second timeout on all HTTP requests; error responses truncated to 500 characters
- SSH output capped at 100 KB
- Docker container runs as unprivileged user

## Testing

```bash
npm test                 # build + node:test suite against a fake OVH API and SSH server
npm run check:contract   # validate every tool request against OVH's published API schemas
```

No OVH credentials are needed for either. Layout and design: [ARCHITECTURE.md](ARCHITECTURE.md).

## Tech Stack

- TypeScript
- `@modelcontextprotocol/sdk`
- Zod (schema validation)
- ssh2 (SSH client)
- Native `fetch`

## API Reference

- [OVH API Console](https://eu.api.ovh.com/console/)
- [OVH API Documentation](https://docs.ovh.com/gb/en/api/)

## License

[MIT](LICENSE)
