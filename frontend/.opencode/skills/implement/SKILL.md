---
name: implement
description: "Implement a piece of work based on a spec, set of tickets, or repasse document."
disable-model-invocation: true
---

Implement the work described by the user in the spec, tickets, or repasse document.

## Repasse workflow

If the work is defined by a repasse document (handoff written by the repasse skill, by default under `.scratch/repasse/`):

1. Ask the user for the document path (default: `.scratch/repasse/`).
2. **Plan first**: read the document in full, then interrogate the user to refine the plan — scope, files to touch, validation criteria — before any execution.
3. Invoke the `repasse` skill (load it via the skill tool) with the refined plan as the conversation context. It writes a new `repasse-YYYYMMDD-HHMM.md` under `.scratch/repasse/`, including a **skills sugeridas** section, and returns the full path.
4. Spawn the `executar-repasse` subagent with the **new** document path so it can read and implement the work, then check its report.
5. Continue with the normal workflow below (review, commit).
6. On success, delete the repasse documents (the executed one and the superseded base document, leaving `.scratch/repasse/` empty). On failure, keep them so the work can be resumed.

## Normal workflow

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
