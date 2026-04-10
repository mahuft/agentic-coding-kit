# Dry-Run Checklist

Use this checklist before writing the final prompt.
The goal is not to implement the task. The goal is to understand enough of the implementation surface that another agent can implement without rediscovery.

## 1. Entry and Ownership

- What package, app, service, command, page, route, worker, or job owns the behavior?
- Where does the request first enter the system?
- Which module appears to be the source of truth?
- Are there adjacent tests that define current behavior?

## 2. Call Chain

- What is the end-to-end path from input to side effect?
- Which functions, classes, hooks, handlers, or jobs participate?
- Where are major branches, guards, retries, or error boundaries?
- Which parts are synchronous vs asynchronous?

## 3. Data and State

- What inputs matter: params, props, config, env vars, database rows, events, files?
- What outputs matter: responses, rendered state, persisted records, emitted events, logs?
- Which types, schemas, tables, or payload contracts constrain the change?
- Where does mutable state live today?

## 4. Side Effects and Dependencies

- Does the path write to storage, call an external API, enqueue work, send events, or mutate caches?
- Are there feature flags, permissions, auth gates, or tenancy boundaries?
- Are there performance-sensitive loops, batching rules, or timeouts?

## 5. Validation Surface

- Which existing tests are closest to this behavior?
- Which package-level command can validate the touched surface?
- Is there a narrow non-mutating check worth running now?
- What manual verification would a future implementer need?

## 6. Unknowns

- Which missing details are resolvable from the repo with more search?
- Which are true product decisions that require the user?
- Which are contradictions that must be called out explicitly?

## Output of the Dry-Run

Before you start writing the final prompt, collect a compact set of notes covering:

- implementation entrypoints,
- subsystem boundaries,
- critical interfaces and data shapes,
- invariants to preserve,
- unresolved decisions,
- and the validation path.

If you cannot produce those notes yet, keep investigating or ask clarifying questions instead of drafting the final prompt.
