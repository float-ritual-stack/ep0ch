#!/usr/bin/env bun
// The daily tile's agent inside Herdr: EP0CH_DAILY_AGENT=<this file>. See src/desk/herdr-agent.ts and the
// README's "The daily agent in Herdr".
import { cli } from "../src/desk/herdr-agent";

process.exit(await cli(import.meta.path, process.argv.slice(2)));
