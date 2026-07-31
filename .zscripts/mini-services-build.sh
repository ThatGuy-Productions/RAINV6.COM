#!/bin/bash
# RAIN V6 — Mini-services build script
# Builds all mini-services into standalone bun bundles.

# Configuration
ROOT_DIR="/home/z/my-project/mini-services"
DIST_DIR="/tmp/build_fullstack_$BUILD_ID/mini-services-dist"

main() {
    echo "Starting batch build..."

    # Check if root directory exists
    if [ ! -d "$ROOT_DIR" ]; then
        echo "INFO: Directory $ROOT_DIR does not exist, skipping build"
        return
    fi

    # Create output directory if it doesn't exist
    mkdir -p "$DIST_DIR"

    # Counters
    success_count=0
    fail_count=0

    # Iterate over all directories in mini-services
    for dir in "$ROOT_DIR"/*; do
        # Check if it's a directory and contains package.json
        if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then
            project_name=$(basename "$dir")

            # Smart entry file lookup (priority order)
            entry_path=""
            for entry in "src/index.ts" "index.ts" "src/index.js" "index.js"; do
                if [ -f "$dir/$entry" ]; then
                    entry_path="$dir/$entry"
                    break
                fi
            done

            if [ -z "$entry_path" ]; then
                echo "WARNING: Skipping $project_name: no entry file found (index.ts/js)"
                continue
            fi

            echo ""
            echo "Building: $project_name..."

            # Build using bun build CLI
            output_file="$DIST_DIR/mini-service-$project_name.js"

            if bun build "$entry_path" \
                --outfile "$output_file" \
                --target bun \
                --minify; then
                echo "SUCCESS: $project_name -> $output_file"
                success_count=$((success_count + 1))
            else
                echo "FAILED: $project_name build failed"
                fail_count=$((fail_count + 1))
            fi
        fi
    done

    if [ -f ./.zscripts/mini-services-start.sh ]; then
        cp ./.zscripts/mini-services-start.sh "$DIST_DIR/mini-services-start.sh"
        chmod +x "$DIST_DIR/mini-services-start.sh"
    fi

    echo ""
    echo "All tasks complete!"
    if [ $success_count -gt 0 ] || [ $fail_count -gt 0 ]; then
        echo "SUCCESS: $success_count"
        if [ $fail_count -gt 0 ]; then
            echo "FAILED: $fail_count"
        fi
    fi
}

main