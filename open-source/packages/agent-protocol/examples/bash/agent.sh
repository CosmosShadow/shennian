#!/bin/bash
#
# Minimal Shennian agent in Bash (spawn mode).
# Echoes the user's message back. Replace the echo logic with your own.
#
# Register:  shennian agent add echo-bash --command "bash /path/to/agent.sh"

set -euo pipefail

case "${1:-}" in
  /caps)
    cat <<'EOF'
{"name":"Echo Agent (Bash)","model":"echo-v1","mode":"spawn","version":"1.0.0"}
EOF
    ;;

  /run)
    workdir=""
    shift
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --workdir) workdir="$2"; shift 2 ;;
        --workdir=*) workdir="${1#*=}"; shift ;;
        *) shift ;;
      esac
    done

    message=$(cat)

    echo "{\"state\":\"delta\",\"text\":\"Echo: ${message//\"/\\\"}\"}"
    echo '{"state":"final"}'
    ;;

  *)
    echo "Usage: $0 /caps | /run --workdir=<path>" >&2
    exit 1
    ;;
esac
