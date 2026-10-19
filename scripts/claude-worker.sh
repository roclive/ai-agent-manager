#!/bin/sh
# aam-worker: claude sonnet
# aam worker adapter that runs headless Claude Code in the task worktree.
# Used via:  AAM_FAKE_WORKER=scripts/claude-worker.sh aam run <ID>
# aam calls it as: <script> <worktree> <promptFile>; aam commits and tests afterwards.
wt="$1"; prompt="$2"; model="${3:-sonnet}"; effort="${4:-default}"
cd "$wt" || exit 1
# UI tasks: borrow the main checkout's UI dependencies (a symlink; aam never commits external symlinks).
[ -d ui ] && [ ! -e ui/node_modules ] && [ -d "$HOME/Desktop/ai-agent-manager/ui/node_modules" ] && ln -s "$HOME/Desktop/ai-agent-manager/ui/node_modules" ui/node_modules
# claude needs USER/LOGNAME for its keychain login; keep the env minimal and explicit.
if [ "$effort" = default ]; then
  exec env -i DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin" HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" \
    perl -e 'alarm 2640; exec @ARGV' \
    claude -p --model "$model" --permission-mode acceptEdits \
    --allowedTools "Bash,Edit,Write,Read,Glob,Grep" --no-session-persistence < "$prompt"
fi
exec env -i DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin" HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" \
  perl -e 'alarm 2640; exec @ARGV' \
  claude -p --model "$model" --effort "$effort" --permission-mode acceptEdits \
  --allowedTools "Bash,Edit,Write,Read,Glob,Grep" --no-session-persistence < "$prompt"
