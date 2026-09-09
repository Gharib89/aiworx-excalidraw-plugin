#!/usr/bin/env bash
# File an adjacent find for triage and leave it alone.
#
#   file-issue --title "<title>" --body-file <path> --label <triage marker>
#
# stdout: {number, url}
# exit: 0 · 1 create failed · 2 usage
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" || { printf '{"error":"cannot source _lib.sh"}\n'; exit 2; }
title=""; file=""; label=""
while [ $# -gt 0 ]; do
  case $1 in
    --title) title=${2:?}; shift 2 ;;
    --body-file) file=${2:?}; shift 2 ;;
    --label) label=${2:?}; shift 2 ;;
    *) ship_tooling "unknown flag: $1" ;;
  esac
done
[ -n "$title" ] && [ -f "$file" ] || ship_tooling 'usage: file-issue --title "<title>" --body-file <path> --label <marker>'
ship_load_host
host_issue_create "$title" "$file" "$label" || ship_fail "issue create failed"
