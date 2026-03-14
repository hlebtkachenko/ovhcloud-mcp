# OVHcloud MCP Server

MCP (Model Context Protocol) server for managing OVHcloud infrastructure directly from AI assistants like Cursor and Claude.

## Features

- **VPS Management** — list, info, monitoring, reboot, start/stop, snapshots
- **Domain & DNS** — list domains, full DNS record CRUD, zone management
- **Account & Billing** — account info, services list, invoices with PDF links
- **Raw API Access** — call any OVHcloud API endpoint directly

22 tools total. No legacy dependencies — uses native OVH API signature (SHA1-HMAC) with `fetch`.

## Requirements

- Node.js 20+
- OVHcloud API credentials ([create here](https://eu.api.ovh.com/createApp/))

## Setup

```bash
npm install
npm run build
```

## Configuration

Add to your MCP config (`~/.cursor/mcp.json` or Claude `settings.json`):

```json
{
  "mcpServers": {
    "ovhcloud": {
      "command": "node",
      "args": ["path/to/ovhcloud-mcp/dist/index.js"],
      "env": {
        "OVH_ENDPOINT": "ovh-eu",
        "OVH_APPLICATION_KEY": "your-app-key",
        "OVH_APPLICATION_SECRET": "your-app-secret",
        "OVH_CONSUMER_KEY": "your-consumer-key"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OVH_APPLICATION_KEY` | Yes | Application key from OVHcloud |
| `OVH_APPLICATION_SECRET` | Yes | Application secret |
| `OVH_CONSUMER_KEY` | Yes | Consumer key (authorized) |
| `OVH_ENDPOINT` | No | API endpoint (default: `ovh-eu`) |

## Tools

### VPS

| Tool | Description |
|------|-------------|
| `ovh_vps_list` | List all VPS services |
| `ovh_vps_info` | Detailed VPS information (hardware, IPs, service dates) |
| `ovh_vps_monitoring` | CPU/network usage statistics |
| `ovh_vps_ips` | List assigned IPs |
| `ovh_vps_reboot` | Reboot VPS |
| `ovh_vps_start` | Start stopped VPS |
| `ovh_vps_stop` | Stop running VPS |
| `ovh_vps_snapshot` | Get snapshot info |
| `ovh_vps_create_snapshot` | Create new snapshot |

### Domains & DNS

| Tool | Description |
|------|-------------|
| `ovh_domain_list` | List all domains and DNS zones |
| `ovh_domain_zone_info` | DNS zone details |
| `ovh_domain_dns_records` | List DNS records (filter by type/subdomain) |
| `ovh_domain_dns_record_detail` | Get specific record |
| `ovh_domain_dns_create` | Create DNS record |
| `ovh_domain_dns_update` | Update DNS record |
| `ovh_domain_dns_delete` | Delete DNS record |
| `ovh_domain_dns_refresh` | Force zone refresh |

### Account & Billing

| Tool | Description |
|------|-------------|
| `ovh_account_info` | Account details |
| `ovh_services` | List all active services |
| `ovh_invoices` | Recent invoices with amounts |
| `ovh_invoice_detail` | Full invoice with line items |

### Advanced

| Tool | Description |
|------|-------------|
| `ovh_api_raw` | Call any OVH API endpoint directly |

## Tech Stack

- TypeScript, MCP SDK (`@modelcontextprotocol/sdk`)
- Native OVH API authentication (no `ovh` npm package)
- Zod schema validation

## License

MIT
