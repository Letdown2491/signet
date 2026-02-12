# Deployment Guide

This guide covers common deployment scenarios for Signet.

## Tailscale Setup

Tailscale provides secure access to Signet without exposing it to the public internet. All devices on your tailnet can reach Signet via its Tailscale hostname.

### Architecture Note

The UI proxies all API requests to the daemon internally:

```
Browser → UI (:4174) → [proxy] → Daemon (:3000)
```

You only expose the UI. The daemon doesn't need direct external access - it communicates with NIP-46 clients via Nostr relays, not HTTP.

### Configuration

Set `UI_URL` to your Tailscale hostname so that `auth_url` responses are reachable from other devices on your tailnet:

```bash
UI_URL=http://signet.tailnet-name.ts.net:4174 docker compose up --build
```

Or in `signet.json`:

```json
{
  "baseUrl": "http://signet.tailnet-name.ts.net:4174",
  "allowedOrigins": [
    "http://signet.tailnet-name.ts.net:4174"
  ]
}
```

Replace `signet.tailnet-name.ts.net` with your actual Tailscale hostname (find it with `tailscale status`).

### HTTPS with Tailscale Serve

Some browser features (like clipboard copy) require HTTPS. Tailscale Serve provides automatic TLS certificates for `*.ts.net` domains:

```bash
# Serve the UI over HTTPS
tailscale serve https / http://localhost:4174
```

Then update your config to use HTTPS:

```json
{
  "baseUrl": "https://signet.tailnet-name.ts.net",
  "allowedOrigins": [
    "https://signet.tailnet-name.ts.net"
  ]
}
```

Note: Tailscale Serve on port 443 means you drop the port from URLs.

### When is UI_URL needed?

| Setup | UI_URL |
|-------|--------------|
| Single machine (Signet + apps on same device) | Not needed (localhost works) |
| Multi-device (Signet on server, apps on phone/laptop) | Required - use Tailscale hostname |

The `auth_url` sent to NIP-46 clients must be reachable from whatever device needs to approve requests. The default `localhost` only works for single-machine setups.

## Wireguard Setup

Wireguard provides secure access to Signet without exposing it to the public internet. This guide assumes you already have a Wireguard VPN configured.

### Architecture Note

The UI proxies all API requests to the daemon internally:

```
Browser → UI (:4174) → [proxy] → Daemon (:3000)
```

You only expose the UI. The daemon doesn't need direct external access - it communicates with NIP-46 clients via Nostr relays, not HTTP.

### Find Your Wireguard IP

Check your Wireguard server's IP address:

```bash
# From your server's Wireguard config
grep Address /etc/wireguard/wg0.conf
# Example output: Address = 10.0.0.1/24

# Or check the active interface
ip addr show wg0
```

Use the server's Wireguard IP (e.g., `10.0.0.1`) - this is reachable from all peers on your VPN.

### Configuration

Set `UI_URL` to your Wireguard IP so that `auth_url` responses are reachable from other devices on your VPN:

```bash
UI_URL=http://10.0.0.1:4174 docker compose up --build
```

Or in `signet.json`:

```json
{
  "baseUrl": "http://10.0.0.1:4174",
  "allowedOrigins": [
    "http://10.0.0.1:4174"
  ]
}
```

Replace `10.0.0.1` with your actual Wireguard server IP.

### HTTPS Note

Some browser features (like clipboard copy) require HTTPS. Unlike Tailscale, Wireguard doesn't provide automatic TLS certificates. Options:

- **Accept the limitation** - Manual copy/paste still works
- **Add a reverse proxy** - Use Caddy or nginx with Let's Encrypt (requires domain + port forwarding, beyond this guide's scope)
- **Self-signed certificate** - Works but triggers browser warnings

For most private network setups, HTTP is fine.

### When is UI_URL needed?

| Setup | UI_URL |
|-------|--------------|
| Single machine (Signet + apps on same device) | Not needed (localhost works) |
| Multi-device (Signet on server, apps on phone/laptop) | Required - use Wireguard IP |

The `auth_url` sent to NIP-46 clients must be reachable from whatever device needs to approve requests. The default `localhost` only works for single-machine setups.

## Systemd Services

Run Signet as systemd services for automatic startup and restart on failure.

### Prerequisites

1. Install Signet to `/opt/signet` (or adjust paths in the service files):

```bash
sudo mkdir -p /opt/signet
sudo chown $USER:$USER /opt/signet
git clone https://github.com/Letdown2491/signet /opt/signet
cd /opt/signet
pnpm install
pnpm run build:daemon
pnpm run build:ui
cd apps/signet && pnpm run prisma:migrate
```

2. Create a dedicated user (optional but recommended):

```bash
sudo useradd -r -s /bin/false signet
sudo chown -R signet:signet /opt/signet
sudo chown -R signet:signet ~/.signet-config  # if config already exists
```

### Service Files

Create `/etc/systemd/system/signet-daemon.service`:

```ini
[Unit]
Description=Signet NIP-46 Daemon
After=network.target

[Service]
Type=simple
User=signet
Group=signet
WorkingDirectory=/opt/signet
ExecStart=/usr/bin/pnpm run start:daemon
Restart=always
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/signet-ui.service`:

```ini
[Unit]
Description=Signet Web UI
After=network.target signet-daemon.service

[Service]
Type=simple
User=signet
Group=signet
WorkingDirectory=/opt/signet
ExecStart=/usr/bin/pnpm run start:ui
Restart=always
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Installation

```bash
# Reload systemd to pick up new service files
sudo systemctl daemon-reload

# Enable services to start on boot
sudo systemctl enable signet-daemon
sudo systemctl enable signet-ui

# Start services
sudo systemctl start signet-daemon
sudo systemctl start signet-ui
```

### Usage

```bash
# Check status
sudo systemctl status signet-daemon
sudo systemctl status signet-ui

# View logs
sudo journalctl -u signet-daemon -f
sudo journalctl -u signet-ui -f

# Restart after updates
sudo systemctl restart signet-daemon
sudo systemctl restart signet-ui

# Stop services
sudo systemctl stop signet-ui
sudo systemctl stop signet-daemon
```

### Notes

- The UI service starts after the daemon (`After=signet-daemon.service`) but doesn't hard-depend on it. If the daemon crashes, the UI stays running and recovers when the daemon restarts.
- Both services use `Restart=always` with a 5-second delay. If a service fails 5 times within 60 seconds, systemd stops trying (prevents runaway restart loops).
- Logs go to journald. Use `journalctl` to view them.
- Adjust `/usr/bin/pnpm` if pnpm is installed elsewhere (check with `which pnpm`).

## Runit Services (Void Linux)

Run Signet as runit services for automatic startup and supervision.

### Prerequisites

Same as systemd setup above - install Signet to `/opt/signet` and optionally create a dedicated user.

### Service Directories

Create `/etc/sv/signet-daemon/run`:

```bash
#!/bin/sh
cd /opt/signet
exec chpst -u signet:signet /usr/bin/pnpm run start:daemon 2>&1
```

Create `/etc/sv/signet-daemon/log/run`:

```bash
#!/bin/sh
exec svlogd -tt /var/log/signet-daemon
```

Create `/etc/sv/signet-ui/run`:

```bash
#!/bin/sh
cd /opt/signet
sv check signet-daemon > /dev/null || exit 1
exec chpst -u signet:signet /usr/bin/pnpm run start:ui 2>&1
```

Create `/etc/sv/signet-ui/log/run`:

```bash
#!/bin/sh
exec svlogd -tt /var/log/signet-ui
```

### Installation

```bash
# Create log directories
sudo mkdir -p /var/log/signet-daemon /var/log/signet-ui

# Make run scripts executable
sudo chmod +x /etc/sv/signet-daemon/run /etc/sv/signet-daemon/log/run
sudo chmod +x /etc/sv/signet-ui/run /etc/sv/signet-ui/log/run

# Enable services (symlink to /var/service)
sudo ln -s /etc/sv/signet-daemon /var/service/
sudo ln -s /etc/sv/signet-ui /var/service/
```

### Usage

```bash
# Check status
sudo sv status signet-daemon
sudo sv status signet-ui

# View logs
sudo tail -f /var/log/signet-daemon/current
sudo tail -f /var/log/signet-ui/current

# Restart services
sudo sv restart signet-daemon
sudo sv restart signet-ui

# Stop services
sudo sv stop signet-ui
sudo sv stop signet-daemon

# Disable services (remove symlink)
sudo rm /var/service/signet-daemon
sudo rm /var/service/signet-ui
```

### Notes

- The UI service checks if the daemon is running before starting (`sv check signet-daemon`). If the daemon isn't up, runit will keep retrying.
- Runit automatically restarts services that exit. No additional configuration needed.
- Logs are managed by `svlogd` with automatic rotation. The `-tt` flag adds timestamps.
- `chpst -u signet:signet` runs the process as the signet user.

## PM2 (Process Manager)

PM2 is a popular Node.js process manager that works on any system. It provides automatic restarts, log management, and monitoring.

### Installation

```bash
npm install -g pm2
```

### Ecosystem File

Create `ecosystem.config.js` in `/opt/signet`:

```javascript
module.exports = {
  apps: [
    {
      name: 'signet-daemon',
      cwd: '/opt/signet',
      script: 'pnpm',
      args: 'run start:daemon',
      env: {
        NODE_ENV: 'production'
      },
      // Restart settings
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/signet/daemon-error.log',
      out_file: '/var/log/signet/daemon-out.log',
      merge_logs: true,
      // Memory management
      max_memory_restart: '500M'
    },
    {
      name: 'signet-ui',
      cwd: '/opt/signet',
      script: 'pnpm',
      args: 'run start:ui',
      env: {
        NODE_ENV: 'production'
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/signet/ui-error.log',
      out_file: '/var/log/signet/ui-out.log',
      merge_logs: true,
      max_memory_restart: '300M'
    }
  ]
};
```

### Usage

```bash
# Create log directory
sudo mkdir -p /var/log/signet
sudo chown $USER:$USER /var/log/signet

# Start all services
cd /opt/signet
pm2 start ecosystem.config.js

# Save PM2 configuration for startup
pm2 save

# Enable PM2 to start on boot
pm2 startup
# (Follow the printed instructions)

# View status
pm2 status

# View logs
pm2 logs signet-daemon
pm2 logs signet-ui

# Restart services
pm2 restart signet-daemon
pm2 restart signet-ui

# Stop services
pm2 stop all

# Monitor in real-time
pm2 monit
```

### Notes

- `max_memory_restart` automatically restarts if memory usage exceeds the threshold
- `max_restarts` and `min_uptime` prevent restart loops
- PM2 provides built-in log rotation with `pm2 install pm2-logrotate`
- Use `pm2 monit` for real-time CPU/memory monitoring

## Docker Compose

Docker provides built-in restart policies for automatic recovery.

### Restart Policies

The `docker-compose.yml` uses `restart: unless-stopped` by default:

```yaml
services:
  signet-daemon:
    restart: unless-stopped
    # ...

  signet-ui:
    restart: unless-stopped
    # ...
```

Available restart policies:

| Policy | Behavior |
|--------|----------|
| `no` | Never restart (default) |
| `always` | Always restart, even after manual stop |
| `unless-stopped` | Restart unless explicitly stopped |
| `on-failure` | Only restart on non-zero exit code |
| `on-failure:3` | Restart on failure, max 3 attempts |

### Health Checks

Add health checks to detect unresponsive containers:

```yaml
services:
  signet-daemon:
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/dashboard/stats"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 30s
    # ...

  signet-ui:
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4174"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 30s
    depends_on:
      signet-daemon:
        condition: service_healthy
    # ...
```

With health checks:
- Docker marks containers as `unhealthy` if checks fail
- Combined with `restart: unless-stopped`, unhealthy containers are restarted
- `depends_on: condition: service_healthy` ensures UI starts only after daemon is healthy

### Viewing Logs

```bash
# Follow logs for all services
docker compose logs -f

# Follow logs for specific service
docker compose logs -f signet-daemon

# View last 100 lines
docker compose logs --tail=100

# View logs with timestamps
docker compose logs -t
```

### Usage

```bash
# Start with restart policy
docker compose up -d

# Check health status
docker compose ps

# Restart a specific service
docker compose restart signet-daemon

# Update and restart
docker compose pull
docker compose up -d --build
```

## fail2ban Integration

If you run fail2ban (or similar tools that modify iptables), WebSocket connections can silently die when the conntrack table is flushed. Signet may appear healthy but stop receiving NIP-46 requests.

### The Problem

When fail2ban bans an IP:
1. iptables rules are updated
2. The conntrack table may be flushed
3. Existing WebSocket connections lose their state
4. Signet's relay connections become unresponsive
5. Health checks pass (they create new connections) but NIP-46 subscriptions are dead

### Solution: Refresh Hook

Signet provides a `POST /connections/refresh` endpoint that forces all relay connections to reset. Hook this into fail2ban actions:

**Create `/etc/fail2ban/action.d/signet-refresh.local`:**

```ini
[Definition]
actionban = curl -s -X POST http://localhost:3000/connections/refresh -H "Authorization: Bearer <token>" || true
actionunban = curl -s -X POST http://localhost:3000/connections/refresh -H "Authorization: Bearer <token>" || true
```

**Note:** If `requireAuth: false` (default), you can omit the Authorization header. If auth is enabled, use a valid JWT token or call from localhost where auth may be bypassed.

**Add to your jail configuration (`/etc/fail2ban/jail.local`):**

```ini
[nginx-http-auth]
enabled = true
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 3
action = iptables-multiport[name=nginx, port="http,https", protocol=tcp]
         signet-refresh
```

### Alternative: Periodic Refresh

If you can't hook into fail2ban, you can set up a cron job to periodically refresh connections:

```bash
# Refresh every 4 hours (adjust as needed)
0 */4 * * * curl -s -X POST http://localhost:3000/connections/refresh
```

This is less targeted but ensures recovery from any silent connection failure.

### Verifying the Fix

After setting up the hook:

1. Trigger a fail2ban ban manually: `sudo fail2ban-client set <jail> banip 1.2.3.4`
2. Check Signet logs for "Relay pool reset" message
3. Verify NIP-46 requests still work

## Process Supervisor Comparison

| Feature | systemd | runit | PM2 | Docker |
|---------|---------|-------|-----|--------|
| Platform | Linux | Linux | Any | Any |
| Auto-restart | ✓ | ✓ | ✓ | ✓ |
| Boot startup | ✓ | ✓ | ✓ | ✓ |
| Log management | journald | svlogd | Built-in | Docker logs |
| Memory limits | cgroups | - | Built-in | Built-in |
| Health checks | - | - | - | Built-in |
| Real-time monitoring | journalctl | tail | pm2 monit | docker stats |

**Recommendations:**
- **systemd**: Best for dedicated Linux servers
- **runit**: Best for Void Linux or minimal setups
- **PM2**: Best for development or cross-platform needs
- **Docker**: Best for containerized deployments with health checks
