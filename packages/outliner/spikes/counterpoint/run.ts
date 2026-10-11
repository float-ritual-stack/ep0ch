// This launcher passes an allowlisted environment: never a real outline, config, agent, or API key.
import { mkdtempSync, mkdirSync, realpathSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const option = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
if (args.includes('--help')) {
  console.log('bun run spike:counterpoint [--port 4318] [--resume /tmp/counterpoint-XXXXXX]\nA private outline and loopback web instrument. Ctrl+C stops both. The outline remains for --resume.');
  process.exit(0);
}
let root = option('--resume');
if (root) {
  root = realpathSync(root);
  if (!root.startsWith('/tmp/counterpoint-') || !existsSync(join(root, 'COUNTERPOINT.json')) || JSON.parse(readFileSync(join(root, 'COUNTERPOINT.json'), 'utf8')).kind !== 'counterpoint-scratch-v1') throw new Error('Resume only a /tmp/counterpoint-* folder created by this launcher.');
} else {
  root = mkdtempSync('/tmp/counterpoint-');
  writeFileSync(join(root, 'COUNTERPOINT.json'), JSON.stringify({kind: 'counterpoint-scratch-v1', created: new Date().toISOString()}));
}
for (const dir of ['config', 'outlines', 'state']) mkdirSync(join(root, dir), {recursive:true, mode:0o700});
const child = Bun.spawn([process.execPath, join(import.meta.dir, 'server.ts')], {
  env: { PATH: process.env.PATH!, HOME: process.env.HOME!, USER: process.env.USER ?? '',
    XDG_CONFIG_HOME: join(root, 'config'), EP0CH_OUTLINES: join(root, 'outlines'), EP0CH_STATE: join(root, 'state'),
    EP0CH_CONTROL: join(root, 'state/door.sock'), EP0CH_WS: 'counterpoint', EP0CH_DAEMON: '0', EP0CH_DAILY_AGENT: 'sh',
    COUNTERPOINT_ROOT: root, COUNTERPOINT_PORT: option('--port') ?? '4318' },
  stdout:'inherit', stderr:'inherit', stdin:'ignore',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
