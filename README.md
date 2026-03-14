# OVHcloud MCP Server

MCP server for managing OVHcloud infrastructure — VPS, domains, DNS, billing, SSH, and full API exploration — from any MCP-compatible client (Cursor, Claude, etc.).

## Features

- **27 purpose-built tools** with typed parameters and Markdown-formatted output
- **API Explorer** — search and discover any OVH API endpoint (500+ endpoints across all services)
- **SSH** — execute commands on remote servers directly through MCP
- **Dual auth** — API key (SHA1-HMAC signature) and OAuth2 (service accounts)
- **Security** — 30s fetch timeouts, path injection prevention, error truncation
- **Docker** — multi-stage build, runs as non-root

## Tools

### VPS (9 tools)

| Tool | Description |
|------|-------------|
| `ovh_vps_list` | List all VPS with hardware details |
| `ovh_vps_info` | Detailed VPS info (hardware, IPs, service status) |
| `ovh_vps_monitoring` | CPU, network RX/TX statistics |
| `ovh_vps_ips` | List assigned IPs |
| `ovh_vps_reboot` | Reboot a VPS |
| `ovh_vps_start` | Start a stopped VPS |
| `ovh_vps_stop` | Stop a running VPS |
| `ovh_vps_snapshot` | Get snapshot info |
| `ovh_vps_create_snapshot` | Create a new snapshot |

### Domains & DNS (8 tools)

| Tool | Description |
|------|-------------|
| `ovh_domain_list` | List all domains and DNS zones |
| `ovh_domain_zone_info` | Zone details (nameservers, DNSSEC) |
| `ovh_domain_dns_records` | List DNS records with filters |
| `ovh_domain_dns_record_detail` | Single record details |
| `ovh_domain_dns_create` | Create a DNS record |
| `ovh_domain_dns_update` | Update a DNS record |
| `ovh_domain_dns_delete` | Delete a DNS record |
| `ovh_domain_dns_refresh` | Force zone refresh |

### Account & Billing (4 tools)

| Tool | Description |
|------|-------------|
| `ovh_account_info` | Account details (name, email, country) |
| `ovh_services` | List all active services |
| `ovh_invoices` | Recent invoices with PDF links |
| `ovh_invoice_detail` | Full invoice with line items |

### API Explorer (3 tools)

| Tool | Description |
|------|-------------|
| `ovh_api_catalog` | List all OVH API categories |
| `ovh_api_search` | Search endpoints by keyword across all APIs |
| `ovh_api_endpoint_detail` | Full parameter details for any endpoint |

### SSH (2 tools)

| Tool | Description |
|------|-------------|
| `ovh_ssh_exec` | Execute a command on a remote server |
| `ovh_ssh_check` | Test SSH connectivity |

### Raw API (1 tool)

| Tool | Description |
|------|-------------|
| `ovh_api_raw` | Call any OVH API endpoint directly |

## Quick Start

### stdio (Cursor / Claude Desktop)

Add to your MCP configuration:

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

### Docker

```bash
docker build -t ovhcloud-mcp .
docker run --rm \
  -e OVH_APPLICATION_KEY=your_key \
  -e OVH_APPLICATION_SECRET=your_secret \
  -e OVH_CONSUMER_KEY=your_consumer \
  ovhcloud-mcp
```

### From source

```bash
npm ci && npm run build
node dist/index.js
```

## Authentication

The server auto-detects auth mode from environment variables.

### API Keys (default)

Get credentials at [OVH Token Creation](https://www.ovh.com/auth/api/createToken). Set all methods (`GET`, `POST`, `PUT`, `DELETE`) with path `/*`.

| Variable | Description |
|----------|-------------|
| `OVH_APPLICATION_KEY` | Application key |
| `OVH_APPLICATION_SECRET` | Application secret |
| `OVH_CONSUMER_KEY` | Consumer key |
| `OVH_ENDPOINT` | API region: `ovh-eu` (default), `ovh-ca`, `ovh-us` |

### OAuth2 (service accounts)

Create a service account via OVH API (`POST /me/api/oauth2/client`) and configure an IAM policy.

| Variable | Description |
|----------|-------------|
| `OVH_CLIENT_ID` | Service account ID |
| `OVH_CLIENT_SECRET` | Service account secret |

Do not set both API keys and OAuth2 credentials at the same time.

### SSH (optional)

| Variable | Description |
|----------|-------------|
| `SSH_HOST` | Default SSH host |
| `SSH_PORT` | Default SSH port (default: 22) |
| `SSH_USER` | Default SSH username |
| `SSH_PASSWORD` | SSH password |
| `SSH_PRIVATE_KEY_FILE` | Path to private key file |

## Security

- **Path injection prevention** — API paths containing `..`, `?`, or `#` are rejected
- **Fetch timeouts** — all HTTP calls have a 30-second timeout
- **Error truncation** — upstream error responses are capped at 500 characters
- **Input validation** — all tool parameters validated with Zod schemas
- **SSH output limits** — stdout/stderr capped to prevent memory issues
- **Non-root Docker** — container runs as unprivileged `node` user

## Testing

```bash
npm test
```

## Architecture

```
src/
  index.ts          Entry point, auth detection, tool registration
  ovh-client.ts     API client (SHA1-HMAC + OAuth2), path validation
  tools/
    vps.ts          VPS management (9 tools)
    domain.ts       Domains and DNS (8 tools)
    account.ts      Account and billing (4 tools)
    explorer.ts     API spec search and discovery (3 tools)
    ssh.ts          Remote command execution (2 tools)
tests/
  ovh-client.test.ts  Client and validation tests
```

## License

MIT
