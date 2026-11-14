#!/usr/bin/env bash
# One stage of the Mars segmentation pipeline (see .github/workflows/mars-segmentation.yml).
set -euo pipefail
cd "$(dirname "$0")/../.."
case "$1" in
  inventory) python pipeline/segmentation/ai4mars_inventory.py ;;
  *) echo "unknown stage $1"; exit 2 ;;
esac
