#!/bin/bash
# This script receives JSON on stdin describing what MiniCcode wants to do.
# It decides whether to allow or block the action.

# Read the JSON that Minicode pipes to us
INPUT=$(cat)

# Extract the command Minicode wants to run
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Check for dangerous patterns
if echo "$COMMAND" | grep -qE "rm -rf /|DROP TABLE|DELETE FROM.*WHERE 1"; then
    # Output structured JSON to block the action
    cat <<'ENDJSON'
{
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Blocked: this looks like a destructive command. Please use a safer alternative."
    }
}
ENDJSON
    exit 0
fi