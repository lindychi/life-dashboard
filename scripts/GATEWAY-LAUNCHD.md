# Gateway Connector Auto-Restart System

The gateway connector now uses macOS launchd for automatic process management. This provides:

1. **Auto-restart on crash** - If the gateway connector crashes, launchd automatically restarts it
2. **Auto-restart on code update** - Call `gracefulRestart()` or send a restart command to reload with new code
3. **Auto-start on login** - Gateway connector starts automatically when you log in

## Installation

Install the launchd service:
```bash
pnpm gateway:install
```

This will:
- Copy the plist file to `~/Library/LaunchAgents/`
- Load and start the service
- Enable auto-restart and auto-start on login

## Management Commands

```bash
pnpm gateway:status     # Check if the service is running
pnpm gateway:restart    # Restart the gateway connector
pnpm gateway:logs       # Tail the live logs
pnpm gateway:uninstall  # Completely remove the service
```

## Log Files

- **stdout**: `/tmp/gateway-connector.log`
- **stderr**: `/tmp/gateway-connector.err`

View live logs:
```bash
tail -f /tmp/gateway-connector.log
```

## Remote Restart

You can trigger a graceful restart from the dashboard by sending a "restart" command:

```typescript
await fetch('/api/relay/command', {
  method: 'POST',
  headers: { 'x-relay-key': RELAY_API_KEY },
  body: JSON.stringify({
    gatewayId: 'your-gateway-id',
    type: 'restart',
    payload: { reason: 'Code updated' }
  })
});
```

The gateway will:
1. Receive the restart command
2. Log the reason
3. Exit gracefully with code 0
4. launchd automatically restarts it within ~5 seconds

## Technical Details

### Files

- `scripts/gateway-connector.plist` - launchd service definition
- `scripts/gateway-setup.sh` - Install/uninstall helper script
- `scripts/gateway-connector.ts` - Gateway connector with restart capability

### How It Works

1. **KeepAlive: true** - launchd watches the process and restarts it if it exits
2. **ThrottleInterval: 5** - Waits 5 seconds between restarts (prevents crash loops)
3. **RunAtLoad: true** - Starts when the plist is loaded (and on login)
4. **gracefulRestart()** - Calls `process.exit(0)` to trigger launchd restart

### Manual launchd Commands

If you prefer using launchctl directly:

```bash
# Load service
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lifedashboard.gateway-connector.plist

# Unload service
launchctl bootout gui/$(id -u)/com.lifedashboard.gateway-connector

# Restart service
launchctl kickstart -k gui/$(id -u)/com.lifedashboard.gateway-connector

# Check status
launchctl print gui/$(id -u)/com.lifedashboard.gateway-connector
```

## Troubleshooting

**Service won't start:**
1. Check logs: `cat /tmp/gateway-connector.err`
2. Verify plist is valid: `plutil -lint ~/Library/LaunchAgents/com.lifedashboard.gateway-connector.plist`
3. Check npx path: `which npx` should be `/opt/homebrew/bin/npx`

**Service keeps crashing:**
1. Check logs for errors
2. Verify environment variables in `.env.local`
3. Check that `RELAY_URL` and `RELAY_API_KEY` are correct

**Service won't restart:**
1. Uninstall and reinstall: `pnpm gateway:uninstall && pnpm gateway:install`
2. Check system logs: `log show --predicate 'process == "launchd"' --last 5m`
