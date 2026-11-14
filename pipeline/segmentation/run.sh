#!/usr/bin/env bash
# One stage of the Mars segmentation pipeline (see .github/workflows/mars-segmentation.yml).
set -euo pipefail
cd "$(dirname "$0")"
case "$1" in
  inventory) python ai4mars_inventory.py ;;
  prepare)   python prepare.py ;;
  train)     python train.py --init "$2" --loss "$3" --minutes "${4:-210}" ;;
  evaluate)  python evaluate.py ;;
  sites)     python infer_sites.py ;;
  *) echo "unknown stage $1"; exit 2 ;;
esac
