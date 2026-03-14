# OVHcloud MCP Server

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

MCP server for [OVHcloud](https://www.ovhcloud.com). Manage VPS, domains, DNS, billing, and execute SSH commands from any MCP-compatible client.

27 tools + full API discovery across 500+ OVH endpoints.

## Requirements

- Node.js 20+
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
| `OVH_ENDPOINT` | Both | `ovh-eu` (default), `ovh-ca`, `ovh-us` |

**SSH** (optional):

| Variable | Description |
|----------|-------------|
| `SSH_HOST` | Default SSH host |
| `SSH_PORT` | Default SSH port (default: 22) |
| `SSH_USER` | Default SSH username |
| `SSH_PASSWORD` | SSH password |
| `SSH_PRIVATE_KEY_FILE` | Path to private key file |

## Tools

### VPS

| Tool | Description |
|------|-------------|
| `ovh_vps_list` | List all VPS with hardware details |
| `ovh_vps_info` | Server state, hardware, IPs, service status |
| `ovh_vps_monitoring` | CPU and network statistics |
| `ovh_vps_ips` | List assigned IPs |
| `ovh_vps_reboot` | Reboot a VPS |
| `ovh_vps_start` | Start a stopped VPS |
| `ovh_vps_stop` | Stop a running VPS |
| `ovh_vps_snapshot` | Get snapshot info |
| `ovh_vps_create_snapshot` | Create a new snapshot |

### Domains & DNS

| Tool | Description |
|------|-------------|
| `ovh_domain_list` | List all domains and DNS zones |
| `ovh_domain_zone_info` | Nameservers, DNSSEC status |
| `ovh_domain_dns_records` | List records with type/subdomain filters |
| `ovh_domain_dns_record_detail` | Single record details |
| `ovh_domain_dns_create` | Create DNS record |
| `ovh_domain_dns_update` | Update DNS record |
| `ovh_domain_dns_delete` | Delete DNS record |
| `ovh_domain_dns_refresh` | Force zone refresh |

### Account & Billing

| Tool | Description |
|------|-------------|
| `ovh_account_info` | Account details (name, email, country) |
| `ovh_services` | List active services with renewal info |
| `ovh_invoices` | Recent invoices with PDF links |
| `ovh_invoice_detail` | Full invoice with line items |

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
| `ovh_ssh_exec` | Execute a command on a remote server |
| `ovh_ssh_check` | Test SSH connectivity |

### Raw API

| Tool | Description |
|------|-------------|
| `ovh_api_raw` | Call any OVH API endpoint directly |

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

- Path injection prevention — `..`, `?`, `#` rejected in API paths
- 30-second timeout on all HTTP requests
- Error responses truncated to 500 characters
- All parameters validated with Zod schemas
- SSH output capped at 100 KB to prevent memory issues
- Docker container runs as unprivileged user

## Testing

```bash
npm test
```

## Architecture

```
src/
  index.ts              Auth detection, tool registration
  ovh-client.ts         API client (SHA1-HMAC + OAuth2), path validation
  tools/
    vps.ts              VPS management (9 tools)
    domain.ts           Domains and DNS (8 tools)
    raw.ts              Raw API calls (1 tool)
    account.ts          Account and billing (4 tools)
    explorer.ts         API spec search and discovery (3 tools)
    ssh.ts              Remote command execution (2 tools)
tests/
  ovh-client.test.ts    Path validation and client tests
```

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
