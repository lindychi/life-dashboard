#!/bin/bash
# Gateway Connector launchd setup
# Usage: ./scripts/gateway-setup.sh [install|uninstall|restart|status|logs]

PLIST_NAME="com.lifedashboard.gateway-connector"
PLIST_SRC="$(dirname "$0")/gateway-connector.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

case "${1:-status}" in
  install)
    # Stop existing if running
    launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null
    # Copy plist
    cp "$PLIST_SRC" "$PLIST_DST"
    # Load and start
    launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
    echo "✅ Gateway connector installed and started"
    echo "   Logs: tail -f /tmp/gateway-connector.log"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null
    rm -f "$PLIST_DST"
    echo "✅ Gateway connector uninstalled"
    ;;
  restart)
    launchctl kickstart -k "gui/$(id -u)/$PLIST_NAME"
    echo "✅ Gateway connector restarted"
    ;;
  status)
    launchctl print "gui/$(id -u)/$PLIST_NAME" 2>/dev/null
    if [ $? -eq 0 ]; then
      echo ""
      echo "✅ Running"
    else
      echo "❌ Not running"
    fi
    ;;
  logs)
    tail -f /tmp/gateway-connector.log
    ;;
  *)
    echo "Usage: $0 [install|uninstall|restart|status|logs]"
    ;;
esac
