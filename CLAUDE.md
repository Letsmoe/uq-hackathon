## Code Style

Prioritize readability and maintainability over cleverness.

- Preserve descriptive names. Do not shorten identifiers.
  - Good: `recordId`, `customerAccount`, `paymentMethod`
  - Bad: `rid`, `acct`, `pm`
- Use `camelCase` for variables, functions, parameters, and object fields
  unless the language, framework, or existing codebase requires otherwise.
- Prefer explicit control flow. Avoid `??`, ternary `?:`, and compact
  conditionals; the only exception is when the explicit form would require
  duplicating a non-trivial expression — a preference for brevity alone is
  not an exception.
- Maximum 2 indentation levels inside a function body. Use guard clauses,
  early returns, or helper functions instead. Extracted helpers must be
  self-contained and meaningfully named — do not split a function into
  arbitrary fragments just to satisfy the indent limit.
- Keep functions short, with one clear responsibility each.
- Comments: only where the code is not readable when skimming. Comments must
  be technical and concise. Never write comments that restate the code, and
  never write historical comments — do not document old decisions, previous
  implementations, or what changed (no "previously...", "changed from...",
  "used to...").
- Do not change behavior, public APIs, data shapes, validation rules, or
  side effects unless explicitly asked. If a required refactor (e.g. for
  the indent rule) would change behavior, stop and ask instead.
- Matching surrounding code style applies only to surface conventions
  (naming casing, quoting, import order, formatting). Existing code that
  violates the structural rules above is not a license to violate them in
  new code — these rules take precedence.

## Code Style Assumptions

Existing code is not authoritative just because it exists. If an existing
pattern looks like a design mistake, do not copy it — ask whether it should
actually look that way, or verify against the framework's documented
approach. The user is the authority. Just because
somebody messed up before doesn't mean you copy it.

This is currently a development project with no users, when editing code do not state what something was changed from, git has the history. When making database changes, ask if the database should be overwritten or migrated and create your files accordingly.

## Tests

After completing your changes, and before committing:

1. Decide whether any change needs a new test. Behavior changes and bug
   fixes need one; pure refactors and comment/style edits do not. If you
   decide no new test is needed, say so in one sentence. New tests go in
   the `tests/` directory.
2. Run `bun test` regardless of whether you wrote a new test. Playwright
   tests take their base URL from the Playwright config — never hardcode
   URLs in test files, even if existing tests do.
3. If tests fail, fix the code until they pass. Never delete, skip,
   weaken, or rewrite a test to make it pass unless the test itself is
   wrong — and if so, say so explicitly and explain why.

## Git

You may use git. Work in this order: change → test → commit → push.

- If the worktree is dirty before you start, commit the existing state
  separately with the message `wip: pre-existing changes`. Never mix
  pre-existing changes into your own commits.
- Commit at each logically complete step (a step that builds and passes
  tests), not one giant commit at the end.
- Commit messages: short, to-the-point title; add a body only when the
  change is not obvious from the title. If a change spans unrelated
  concerns, split it into multiple commits.
- Mention in the commit message that the commit was made by you (an AI)
  and not a human. Do not use a `Co-Authored-By` trailer.
- On a feature branch: commit only changes belonging to that branch's
  feature, then merge back into main. Merge only after verification
  passes — never merge red. Unrelated changes go on a separate branch.
- Push only after verification passes. Never force-push.
