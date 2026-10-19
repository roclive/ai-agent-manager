#!/bin/sh
# aam-worker: claude opus
# aam worker adapter that runs headless Claude Code in the task worktree.
# Used via:  AAM_FAKE_WORKER=scripts/claude-worker.sh aam run <ID>
# aam calls it as: <script> <worktree> <promptFile>; aam commits and tests afterwards.
wt="$1"; prompt="$2"
model="${AAM_CLAUDE_MODEL:-${3:-opus}}"
effort="${AAM_CLAUDE_EFFORT:-${4:-max}}"
[ "$effort" = default ] && effort=max
fast="${AAM_CLAUDE_FAST:-${5:-true}}"
case "$fast" in false|0) fast=false ;; *) fast=true ;; esac
timeout_min="${6:-45}"
case "$timeout_min" in ""|*[!0-9.]*) echo "Invalid worker timeout" >&2; exit 1 ;; esac
cd "$wt" || exit 1
# UI tasks: borrow the main checkout's UI dependencies (a symlink; aam never commits external symlinks).
[ -d ui ] && [ ! -e ui/node_modules ] && [ -d "$HOME/Desktop/ai-agent-manager/ui/node_modules" ] && ln -s "$HOME/Desktop/ai-agent-manager/ui/node_modules" ui/node_modules
# claude needs USER/LOGNAME for its keychain login; keep the env minimal and explicit.
exec env -i DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin" HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" \
  perl -e 'my $minutes = shift @ARGV; die "Invalid worker timeout" unless $minutes =~ /\A[0-9]+(?:\.[0-9]+)?\z/ && $minutes > 0; alarm(int($minutes * 60) || 1); exec @ARGV' "$timeout_min" \
  "${AAM_FAKE_CLAUDE:-claude}" -p --model "$model" --effort "$effort" --settings "{\"fastMode\":$fast}" --permission-mode acceptEdits \
  --allowedTools "Bash,Edit,Write,Read,Glob,Grep" --no-session-persistence < "$prompt"
