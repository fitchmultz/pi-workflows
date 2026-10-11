# Scripted workflows

[Back to the README](../README.md)

A scripted workflow coordinates workers with JavaScript. Use it for repeated checks across files, independent review passes, or a reusable sequence with a final merge step. Use a recipe when the outcome still needs a product decision or design approval.

## Write a script

A script declares a command name and description, uses top-level `await`, and returns the result to show in Pi:

```js
export const meta = {
  name: 'audit-routes',
  description: 'Audit every route handler for missing auth checks',
}

const found = await agent('List every .ts file under src/routes/.', {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})
if (!found || !Array.isArray(found.files)) return 'Could not list route files.'

const audits = await pipeline(found.files, file =>
  agent(`Audit ${file} for missing authentication checks.`, { label: file }),
)

return audits.filter(Boolean)
```

`agent(prompt, options)` starts a fresh Pi CLI worker. `label` identifies it in run events; `schema` asks it for JSON. JSON is parsed, but the runtime does not validate the returned object against the schema. Handle missing fields and `null` results in your script.

`pipeline(items, callback)` applies the callback concurrently, with at most 16 in flight, and returns results in input order. `args` holds the arguments supplied to the workflow. Saved slash commands receive their arguments as a string.

The runtime permits at most 16 simultaneous workers and 1,000 `agent()` calls per run, including replayed calls. Scripted workers use the native `read`, `write`, `edit`, `bash`, `grep`, `find` and `ls` tools. Their extension, skill and prompt-template discovery is disabled; they do not inherit recipe agent roles or browser tools.

## Worker results

`agent()` returns `null` if a worker is stopped, fails, reaches its output limit, has invalid requested JSON, or never produces a completed final assistant response. A usable result requires the latest assistant to finish with stop reason `stop` and the child process to exit successfully. Empty output also returns `null`.

The JSONL parser keeps the current record and latest assistant rather than all worker stdout. It handles fragmented UTF-8 and an unterminated final record at EOF. Logs and queued/handled input receipts never substitute for a finished answer; child print mode must finish and exit successfully.

Every started worker settles before a workflow reports completion. A script should still await its orchestration so its return value contains the results it needs.

## Approval and controls

The terminal approval card uses Pi's native SelectList/Text controls. Configured navigation, confirmation and cancellation keys take precedence; left/right/Tab remain fallback shortcuts. Fullscreen also supports mouse input.

- **Once** runs the current script.
- **Always** records the workflow name in the project's `.pi/workflow-allow` file. Later scripts with that name skip approval in that project.
- **View** opens the script for reading or editing, then returns to the card.
- **Deny** or cancellation does not start the run.

RPC uses a confirmation dialog. Non-UI mode runs without the selector. Project-local Always also bypasses future RPC confirmation for the allowed name.

Scripts reject direct `import`, `require`, `fetch`, `eval`, `Function` and access to `process`, `Deno` or `Bun`. The Node VM and these lexical restrictions do not provide a security sandbox or CPU deadline. Approve only trusted scripts. Workers retain their native CLI tool authority.

Trigger phrases are `use a workflow`, `run a workflow`, `write a workflow` and `ultracode`. Alt+W / Option+W dismisses the editor highlight and its workflow steering for the current trigger.

## Size guidelines

These settings guide the model when it writes a script; they do not change the runtime limits.

```text
/workflow-size              # show the current setting
/workflow-size small        # fewer than 5 agents
/workflow-size medium       # fewer than 15 agents; default
/workflow-size large        # fewer than 50 agents
/workflow-size unrestricted # no agent-count guideline
```

The setting is stored in `.pi/workflow-size` in the repository. Starting Pi with `--workflow-size medium` overrides the saved setting for that process.

## Pause, resume and save

`/workflows` lists recipes, skills, agents, saved scripts, size, missing recipe tools and run status. Use `/workflows status` to show the summary without selecting a run. With an existing run, `/workflows` offers View, Pause, Resume, Stop and Save.

Pause and Stop both abort owned children and leave the run paused. Resume reruns the script, replays the cached prefix of completed calls and retries from the first unfinished call. Later calls may run again; keep that in mind when workers change files. Failed workers that returned `null` are completed calls and may be cached.

Run state belongs to the extension instance and is held in memory. Session shutdown aborts and awaits owned workers before UI and report callbacks become stale. Resume does not persist across shutdown or replacement sessions.

Save writes `.pi/workflows/<name>.js`. The saved name becomes a slash command on the next session start. Saved scripts are discovered from the current directory up to the repository root; nearer definitions override parent definitions. The name must be lowercase, begin with a letter, and contain only letters, digits or hyphens.

The bundled `/deep-research <question>` script asks a worker for research angles, fans out those angles, then asks another worker to cross-check and synthesize a cited report. It uses the same worker tool policy and approval path as other scripts.
