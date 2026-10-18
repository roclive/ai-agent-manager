#!/bin/sh
# Move blocked tasks back to ready, restoring the last auto-review notes as feedback.
# Usage: scripts/retry-blocked.sh [KEY ...]   (default: AAM BIB NPO SB TM)
cd "$(dirname "$0")/.." || exit 1
keys="${*:-AAM BIB NPO SB TM}"
for id in $(./bin/aam task list | awk '$3=="blocked"{print $1}'); do
  key="${id%%-*}"
  case " $keys " in *" $key "*) ;; *) continue ;; esac
  tmp=$(mktemp)
  sqlite3 .aam/aam.db "select message from events where task_id=(select id from tasks where identifier='$id') and kind='auto_review' order by id desc limit 1" | sed 's/^reject: //' > "$tmp"
  ./bin/aam task move "$id" ready >/dev/null && { [ -s "$tmp" ] && ./bin/aam task edit "$id" --feedback-file "$tmp" >/dev/null; }
  echo "retry $id (feedback $(wc -c < "$tmp") bytes)"
  rm -f "$tmp"
done
