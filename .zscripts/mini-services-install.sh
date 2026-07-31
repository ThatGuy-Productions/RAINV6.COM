#!/bin/bash
# RAIN V6 — Mini-services dependency installer
# Installs bun dependencies for all mini-services.

# Configuration
ROOT_DIR="/home/z/my-project/mini-services"

main() {
    echo "Starting batch dependency install..."

    # Check if root directory exists
    if [ ! -d "$ROOT_DIR" ]; then
        echo "INFO: Directory $ROOT_DIR does not exist, skipping install"
        return
    fi

    # Counters
    success_count=0
    fail_count=0
    failed_projects=""

    # Iterate over all directories in mini-services
    for dir in "$ROOT_DIR"/*; do
        # Check if it's a directory and contains package.json
        if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then
            project_name=$(basename "$dir")
            echo ""
            echo "Installing dependencies: $project_name..."

            # Enter project directory and run bun install
            if (cd "$dir" && bun install); then
                echo "SUCCESS: $project_name dependencies installed"
                success_count=$((success_count + 1))
            else
                echo "FAILED: $project_name dependency install failed"
                fail_count=$((fail_count + 1))
                if [ -z "$failed_projects" ]; then
                    failed_projects="$project_name"
                else
                    failed_projects="$failed_projects $project_name"
                fi
            fi
        fi
    done

    # Summary
    echo ""
    echo "=================================================="
    if [ $success_count -gt 0 ] || [ $fail_count -gt 0 ]; then
        echo "Install complete!"
        echo "SUCCESS: $success_count"
        if [ $fail_count -gt 0 ]; then
            echo "FAILED: $fail_count"
            echo ""
            echo "Failed projects:"
            for project in $failed_projects; do
                echo "  - $project"
            done
        fi
    else
        echo "INFO: No projects with package.json found"
    fi
    echo "=================================================="
}

main