#!/bin/bash
# RAIN V6 — Production build script
# Builds Next.js standalone + mini-services into a deployment package.
# Redirect stderr to stdout so execute_command doesn't fail on stderr output.
exec 2>&1

set -e

# Script directory (.zscripts)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NEXTJS_PROJECT_DIR="/home/z/my-project"

if [ ! -d "$NEXTJS_PROJECT_DIR" ]; then
    echo "ERROR: Next.js project directory not found: $NEXTJS_PROJECT_DIR"
    exit 1
fi

echo "Building Next.js app and mini-services..."
echo "Next.js project: $NEXTJS_PROJECT_DIR"

cd "$NEXTJS_PROJECT_DIR" || exit 1

export NEXT_TELEMETRY_DISABLED=1

BUILD_DIR="/tmp/build_fullstack_$BUILD_ID"
echo "Build directory: $BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "Installing dependencies..."
bun install

echo "Building Next.js app..."
bun run build

# Validate standalone server entry — deployment success rate guard.
# Next only produces .next/standalone/server.js when next.config has output:"standalone".
# bun run build succeeds (exit 0, static output generated) even without it, but the
# deployment package lacks server.js. This causes the deployed function to fail startup
# (Caddy proxies to nothing on port 3000, FC health check 120s timeout → warmup_412).
# Self-heal: inject output:"standalone" into next.config if server.js is missing.
if [ ! -f ".next/standalone/server.js" ]; then
    echo "WARNING: Build did not produce .next/standalone/server.js — attempting self-heal..."

    NEXT_CONFIG_FILE="$(ls next.config.ts next.config.js next.config.mjs next.config.cjs 2>/dev/null | head -1)"

    if [ -z "$NEXT_CONFIG_FILE" ]; then
        echo "ERROR: No next.config.* found — cannot generate standalone deployment artifact."
        exit 1
    fi

    if grep -Eq "output\s*:\s*['\"]standalone['\"]" "$NEXT_CONFIG_FILE"; then
        echo "ERROR: $NEXT_CONFIG_FILE already has output:\"standalone\" but server.js is still missing."
        echo "       Check the build output above for errors or custom distDir config."
        exit 1
    fi

    if grep -Eq "output\s*:\s*['\"]" "$NEXT_CONFIG_FILE"; then
        echo "ERROR: $NEXT_CONFIG_FILE has a non-standalone output (e.g. \"export\")."
        echo "       Export mode is incompatible with this deployment model (standalone + custom server)."
        echo "       Switch to output:\"standalone\" or confirm this project should use static hosting."
        exit 1
    fi

    echo "Injecting output:\"standalone\" into $NEXT_CONFIG_FILE and rebuilding..."
    cp "$NEXT_CONFIG_FILE" "${NEXT_CONFIG_FILE}.zbak"
    perl -0pi -e 's/((?:const\s+\w+[^=]*=|export\s+default|module\.exports\s*=)\s*\{)/$1\n  output: "standalone",/' "$NEXT_CONFIG_FILE"

    if ! grep -Eq "output\s*:\s*['\"]standalone['\"]" "$NEXT_CONFIG_FILE"; then
        echo "ERROR: Could not inject output:\"standalone\" — next.config format not recognized."
        echo "       Current $NEXT_CONFIG_FILE content:"
        cat "$NEXT_CONFIG_FILE"
        mv "${NEXT_CONFIG_FILE}.zbak" "$NEXT_CONFIG_FILE"
        exit 1
    fi

    echo "Rebuilding with injected standalone config..."
    bun run build

    if [ ! -f ".next/standalone/server.js" ]; then
        echo "ERROR: Still no .next/standalone/server.js after injection + rebuild."
        exit 1
    fi
    echo "Self-heal successful: standalone server entry generated."
fi

# Build mini-services (if present)
if [ -d "$NEXTJS_PROJECT_DIR/mini-services" ]; then
    echo "Building mini-services..."
    sh "$SCRIPT_DIR/mini-services-install.sh"
    sh "$SCRIPT_DIR/mini-services-build.sh"

    echo "  - Copying mini-services-start.sh to $BUILD_DIR"
    cp "$SCRIPT_DIR/mini-services-start.sh" "$BUILD_DIR/mini-services-start.sh"
    chmod +x "$BUILD_DIR/mini-services-start.sh"
else
    echo "mini-services directory not found — skipping"
fi

# Collect all build artifacts
echo "Collecting build artifacts into $BUILD_DIR..."

if [ -d ".next/standalone" ]; then
    echo "  - Copying .next/standalone"
    cp -r .next/standalone "$BUILD_DIR/next-service-dist/"
fi

if [ -d ".next/static" ]; then
    echo "  - Copying .next/static"
    mkdir -p "$BUILD_DIR/next-service-dist/.next"
    cp -r .next/static "$BUILD_DIR/next-service-dist/.next/"
fi

if [ -d "public" ]; then
    echo "  - Copying public"
    cp -r public "$BUILD_DIR/next-service-dist/"
fi

# Copy test database into build artifact (production starts from this snapshot)
if [ -f "./db/custom.db" ]; then
    echo "Copying test database snapshot to build artifact..."
    mkdir -p "$BUILD_DIR/db"
    cp -r ./db/. "$BUILD_DIR/db/"

    echo "Syncing build artifact database schema..."
    DATABASE_URL="file:$BUILD_DIR/db/custom.db" bun run db:push
    echo "Build artifact database ready"
    ls -lah "$BUILD_DIR/db"
else
    echo "ERROR: Test database file ./db/custom.db not found — cannot produce production package"
    exit 1
fi

if [ -f "Caddyfile" ]; then
    echo "  - Copying Caddyfile"
    cp Caddyfile "$BUILD_DIR/"
else
    echo "Caddyfile not found — skipping"
fi

echo "  - Copying start.sh to $BUILD_DIR"
cp "$SCRIPT_DIR/start.sh" "$BUILD_DIR/start.sh"
chmod +x "$BUILD_DIR/start.sh"

# Package
PACKAGE_FILE="${BUILD_DIR}.tar.gz"
echo ""
echo "Packaging build artifact to $PACKAGE_FILE..."
cd "$BUILD_DIR" || exit 1
tar -czf "$PACKAGE_FILE" .
cd - > /dev/null || exit 1

echo ""
echo "Build complete! Package: $PACKAGE_FILE"
echo "Package size:"
ls -lh "$PACKAGE_FILE"
