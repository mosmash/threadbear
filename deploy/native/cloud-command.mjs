// Private credential parsing stays inside the one-shot native worker.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const settings = JSON.parse(fs.readFileSync(0, 'utf8'));
const env = { ...process.env };
for (const key of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY']) delete env[key];
for (const line of fs.readFileSync(settings.config, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
}
const input = settings.inputFile ? fs.readFileSync(settings.inputFile) : undefined;
const args = settings.args;
const cli = args[0] === 'static-hosting'
  ? '/opt/threadbear/node_modules/.bin/static-hosting' : '/opt/threadbear/node_modules/convex/bin/main.js';
const r = spawnSync(process.execPath, [cli, ...(args[0] === 'static-hosting' ? args.slice(1) : args)],
  { env, cwd: '/work', input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? ''); process.exit(r.status ?? 1);
