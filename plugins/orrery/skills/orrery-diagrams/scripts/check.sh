#!/usr/bin/env sh
# Validate an Orrery model, render one still, and write every export to a temporary directory.
# Usage: check.sh <model.orrery.json> [out-dir]
set -e
file="${1:?usage: check.sh <model.orrery.json> [out-dir]}"
out="${2:-$(mktemp -d)}"
npx --yes orrery-diagrams validate "$file"
npx --yes orrery-diagrams render "$file" --static -o "$out/still.svg"
if grep -q '"exports"' "$file"; then npx --yes orrery-diagrams export "$file" --out "$out"; fi
echo "pictures in $out"
ls "$out"
