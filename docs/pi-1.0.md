# Pi 1.0 contracts and qualification

## Scope and decisions

This remains a project-local `.pi` recipes/skills/agents/script kit, not a global Pi extension or an AgentHarness rewrite. Pi 1.0.0 is the supported floor; Git/GitHub is the historical delivery channel. Do not publish the foreign npm name. Preserve project/user resources and live runtime/settings/auth during qualification.

The canonical recipe sources are `reference/workflows` plus `scripts/build.mjs`; generated `.pi/{skills,agents,prompts}` must only change through regeneration. Roles, task evidence, fresh child context and approval gates are unchanged. The scripted worker remains a JSON CLI child with explicit `--no-session`, `--no-approve`, disabled extension/skill/template discovery and the existing tool allowlist. It does not inherit recipe agent roles or become a new SDK worker engine.

Worker results come only from the latest completed assistant with stopReason `stop`, successful process exit and no cancellation. Length/error/aborted/toolUse/missing or unfinished assistants return null; raw stdout is not a result. Incremental UTF-8/LF parsing flushes EOF and discards completed records. This addresses concrete accumulation of every tool record and unqualified partial output without adding a dependency or speculative engine.

Run state is extension-instance-local. Started workers settle before completion, and shutdown aborts/awaits owned work while old contexts remain valid. Cancellation remains unfinished for resume. CustomEditor forwards native app keys and mouse/focus behavior; approval now composes native Container/Text/SelectList plus the host editor/confirmation instead of a width-unaware custom button row. Plain ctx.ui.select has no mouse actions in exact 1.0, so the card forwards native SelectList pointer routing. Native configured navigation/confirm/cancel keys take precedence; the old left/right/Tab path remains only when the key is not claimed by those native actions. The host custom factory owns done, focus and disposal; no second terminal is created. Always remains project-local, RPC confirms and non-UI execution retains its existing automatic policy.

Trusted local scripts have the existing runtime ceiling: Node vm plus lexical restrictions is not a security sandbox or a CPU deadline. A truly untrusted-script product would require an isolated bounded runtime, not more regex rules.

## Exact source

Official v1.0.0 source: [`a13d35a742c6ef8462812a28fbe1d8c8b7431c32`](https://github.com/earendil-works/pi/tree/a13d35a742c6ef8462812a28fbe1d8c8b7431c32). Inspect `packages/coding-agent/{docs/{sdk,cli-integration,json,extensions,tui}.md,src/{core/{sdk,agent-session,agent-session-runtime}.ts,modes/{print-mode.ts,rpc/rpc-mode.ts}}}` and `packages/tui` component/keybinding contracts. Agent-core 1.0 removed experimental harness/session/storage exports; this kit never imported them. Public session/boundary APIs mostly predate 1.0; fullscreen is now the default.

Qualification uses public `dist/index.js` and actual manifest-bin `dist/bundle/cli.js`, the complete eight-package 1.0.0 cohort and TypeBox 1.3.27, under physical Node 24.21.0. Resolve nested companions from the selected host graph. Set selected `PI_PACKAGE_DIR` explicitly; an inherited older fork override can make even an absolute official CLI load another resource root. Use an allowlisted environment and isolated HOME/agentDir/project, never reload this project's auto-discovered extensions into an operator session.

The maintained fork starts from official 1.0 and keeps only restart/background_command/discover_tools/Read JSON/compactView. This kit needs none of those optional additions and does not require dropped checkpoint/metadata/usage/publisher/TUI/RPC APIs. Candidate-specific qualification is not claimed before an exact built artifact is available.

## Repeatable checks

```bash
npm ci --ignore-scripts
npm run build          # canonical regeneration; inspect the resulting diff
npm run check:compat   # generated check, strict tsc, Node/native/child CLI tests
npm pack --dry-run --ignore-scripts
```

Normal checks need no paid model. Native tests copy project assets into an isolated trusted project, verify discovery/command/tool behavior and use a local provider for actual CLI success/length/shutdown. Transport tests independently cover final assistant, fragmented UTF-8, EOF, missing/partial/error output, nonzero exit and pre/mid cancellation. UI tests cover approval/edit/denial/Always policy and real CustomEditor keys/width/CJK. Inspect the actual CLI fullscreen (default) and regular cards, editor, keyboard/mouse/focus, narrow/wide/CJK/resize/cancel and session replacement/disposal separately; fixture success is not a visual inspection or proof of external recipe tools.
