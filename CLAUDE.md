# Xavi Agent Runtime Notes

This repository contains the independent TypeScript Pi-agent runtime for Xavi.

## Active Agent

- Xavi: video editing, Remotion animation, and social content.

Do not add other coworkers or legacy Python/Azure runtime paths back into this repository. Other agents live in their own repositories.

## Runtime

- App: `apps/coworkers-core`
- Prompts: `src/agents/xavi`
- Sokosumi Pi extension: `@masumi-network/pi-sokosumi`
- Pi package registration: `.pi/settings.json`
- Build/test: `pnpm typecheck`, `pnpm test`, `pnpm build`
- Start: `pnpm start`
- Health: `GET /healthz`

`@masumi-network/pi-sokosumi` is consumed from the separate GitHub repository. Keep imports through package subpaths like `@masumi-network/pi-sokosumi/worker`.
