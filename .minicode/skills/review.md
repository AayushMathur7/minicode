---
description: Review recent code changes for quality, bugs, and improvements
---

Review the code that was recently changed in this repository.

## Steps

1. Run `git diff HEAD~1` to see what changed
2. For each changed file, read the full file to understand context
3. Check for:
   - Bugs or logic errors
   - Missing error handling
   - Type safety issues
   - Code that could be simplified
   - Naming that could be clearer
4. If you find issues, list them clearly with file paths and line references
5. If the code is clean, say so briefly

## Guidelines

- Be specific: point to exact lines, not vague suggestions
- Prioritize correctness over style
- Don't nitpick formatting — focus on logic and safety
- If a fix is trivial and obvious, just fix it instead of reporting it
