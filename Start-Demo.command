#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  node scripts/serve-demo.mjs --open
elif [[ -x "$HOME/.local/bin/node" ]]; then
  "$HOME/.local/bin/node" scripts/serve-demo.mjs --open
elif [[ -x /opt/homebrew/bin/node ]]; then
  /opt/homebrew/bin/node scripts/serve-demo.mjs --open
elif [[ -x /usr/local/bin/node ]]; then
  /usr/local/bin/node scripts/serve-demo.mjs --open
else
  print 'Node.js is required. Please install Node.js, then open this file again.'
fi
read -r '?Press Enter to close this window.'
