#!/bin/bash
# Bootstrap test harness vendor dependencies
# Run from repo root: bash test/setup.sh

set -e
cd "$(dirname "$0")/.."

echo "Installing npm deps..."
npm install --silent preact @preact/signals htm esbuild @tailwindcss/cli 2>/dev/null

echo "Building vendor bundles..."
mkdir -p test/vendor
npx esbuild node_modules/preact/src/index.js --bundle --format=esm --outfile=test/vendor/preact.mjs 2>/dev/null
npx esbuild node_modules/preact/hooks/src/index.js --bundle --format=esm --external:preact --outfile=test/vendor/preact-hooks.mjs 2>/dev/null
npx esbuild node_modules/@preact/signals/dist/signals.mjs --bundle --format=esm --external:preact --external:"preact/*" --outfile=test/vendor/preact-signals.mjs 2>/dev/null
npx esbuild node_modules/htm/preact/index.mjs --bundle --format=esm --external:preact --outfile=test/vendor/htm-preact.mjs 2>/dev/null

echo "Building Tailwind CSS..."
cat > test/input.css << 'CSS'
@import "tailwindcss";
@source "../index.html";
@source "../callback.html";
@source "../src/**/*.js";
CSS
npx @tailwindcss/cli -i test/input.css -o test/vendor/tailwind.css --minify 2>/dev/null
rm test/input.css

echo "Vendor bundles ready:"
ls -la test/vendor/
echo ""
echo "Run harness: python3 test/harness.py"
