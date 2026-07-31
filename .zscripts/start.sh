#!/bin/sh
# RAIN V6 — Production startup script
# Starts Next.js server, mini-services, and Caddy reverse proxy.

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR"

# Store all child process PIDs
pids=""

# Cleanup function: gracefully shut down all services
cleanup() {
    echo ""
    echo "Shutting down all services..."

    # Send SIGTERM to all child processes
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            service_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
            echo "   Shutting down process $pid ($service_name)..."
            kill -TERM "$pid" 2>/dev/null
        fi
    done

    # Wait for all processes to exit (max 5 seconds)
    sleep 1
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            # Still running, wait up to 4 more seconds
            timeout=4
            while [ $timeout -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
                sleep 1
                timeout=$((timeout - 1))
            done
            # If still running, force kill
            if kill -0 "$pid" 2>/dev/null; then
                echo "   Force killing process $pid..."
                kill -KILL "$pid" 2>/dev/null
            fi
        fi
    done

    echo "All services stopped"
    exit 0
}

echo "Starting all services..."
echo ""

# Change to build directory
cd "$BUILD_DIR" || exit 1

ls -lah

DEFAULT_PACKAGED_DB_PATH="/app/db/custom.db"
DEFAULT_PACKAGED_DATABASE_URL="file:$DEFAULT_PACKAGED_DB_PATH"

# Start Next.js server
if [ -f "./next-service-dist/server.js" ]; then
    echo "Starting Next.js server..."
    cd next-service-dist/ || exit 1

    # Set environment variables
    export NODE_ENV=production
    export PORT="${PORT:-3000}"
    export HOSTNAME="${HOSTNAME:-0.0.0.0}"
    export DATABASE_URL="${DATABASE_URL:-$DEFAULT_PACKAGED_DATABASE_URL}"

    if [ "$DATABASE_URL" = "$DEFAULT_PACKAGED_DATABASE_URL" ]; then
        if [ ! -f "$DEFAULT_PACKAGED_DB_PATH" ]; then
            echo "ERROR: Packaged database file not found: $DEFAULT_PACKAGED_DB_PATH"
            echo "   Aborting startup to prevent launching with empty database"
            exit 1
        fi

        echo "Using packaged database: $DEFAULT_PACKAGED_DB_PATH"
    else
        echo "Using external database: $DATABASE_URL"
    fi

    # Start Next.js in background
    bun server.js &
    NEXT_PID=$!
    pids="$NEXT_PID"

    # Brief check that process started successfully
    sleep 1
    if ! kill -0 "$NEXT_PID" 2>/dev/null; then
        echo "ERROR: Next.js server failed to start"
        exit 1
    else
        echo "Next.js server started (PID: $NEXT_PID, Port: $PORT)"
    fi

    cd ../
else
    echo "WARNING: Next.js server file not found: ./next-service-dist/server.js"
fi

# Start mini-services
if [ -f "./mini-services-start.sh" ]; then
    echo "Starting mini-services..."

    # Run startup script from root directory (script handles mini-services-dist internally)
    sh ./mini-services-start.sh &
    MINI_PID=$!
    pids="$pids $MINI_PID"

    # Brief check
    sleep 1
    if ! kill -0 "$MINI_PID" 2>/dev/null; then
        echo "WARNING: mini-services may have failed to start, continuing..."
    else
        echo "mini-services started (PID: $MINI_PID)"
    fi
elif [ -d "./mini-services-dist" ]; then
    echo "WARNING: mini-services startup script not found, but directory exists"
else
    echo "INFO: mini-services directory not found, skipping"
fi

# Start Caddy (if Caddyfile exists)
echo "Starting Caddy..."

# Caddy runs as foreground process (main process)
echo "Caddy started (foreground)"
echo ""
echo "All services started!"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Caddy runs as the main process
exec caddy run --config Caddyfile --adapter caddyfile
