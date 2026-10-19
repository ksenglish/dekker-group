#!/bin/sh
# Starts the API with a heap cap matched to the instance it is running on.
#
# The cap has to be worked out at the moment of starting, because it comes from
# the container's own memory limit rather than from a number written down — see
# src/heap-budget.js for why that matters. That means a shell, and the shell
# has to be here rather than in render.yaml: Render does not do variable
# interpolation in Blueprint files, so a $(...) written there fails the
# Blueprint sync rather than being run. Their own guidance is to put it in a
# start script, which is this.
#
# exec, so this shell is replaced by node rather than sitting around as a
# parent process. On a small instance an idle extra Node or shell is memory
# spent on nothing, which is the very thing being fixed here.
#
# Paths are resolved from this file rather than from the working directory, so
# it does not matter where it is called from.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)

# Prints "--max-old-space-size=N", or nothing at all when there is no container
# limit to go by. Unquoted on purpose: nothing means no argument, not an empty
# one. If it cannot work out a budget the server still starts, just without the
# cap — a server running is worth more than a server tuned.
FLAG=$(node "$DIR/src/heap-budget.js" 2>/dev/null || true)

exec node $FLAG "$DIR/src/index.js"
