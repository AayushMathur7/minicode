---
description: Create a well-formatted git commit for staged changes
---

Create a git commit for the current staged changes.

## Steps

1. Run `git status` to see what's staged
2. Run `git diff --cached` to see the actual changes
3. Analyze the changes and write a commit message following conventional commits:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `refactor:` for code restructuring
   - `docs:` for documentation
   - `test:` for test changes
   - `chore:` for maintenance
4. Keep the subject line under 72 characters
5. Add a body if the change needs explanation (what and why, not how)
6. Run `git commit -m "<message>"` with the crafted message

## Guidelines

- Read the diff carefully — the message should reflect what ACTUALLY changed
- Don't commit if nothing is staged — tell the user
- If changes span multiple concerns, suggest splitting into multiple commits
