---
name: implement
description: "Implement a piece of work based on a spec, set of tickets, or repasse document."
disable-model-invocation: true
---

Implement the work described by the user in the spec, tickets, or repasse document.

## Repasse workflow

If the work is defined by a repasse document (handoff written by the repasse skill, by default under `.scratch/repasse/`):

1. Ask the user for the document path (default: `.scratch/repasse/`).
2. Spawn the `executar-repasse` subagent with the path so it can read and implement the work, then check its report.
3. Continue with the normal workflow below (review, commit).
4. On success, delete the repasse document. On failure, keep it so the work can be resumed.

## Normal workflow

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
