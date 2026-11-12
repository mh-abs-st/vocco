// `npm run dev`: the server and the web app together, on any OS (Windows cmd has no `&`).
import { spawn } from 'node:child_process';

const run = (name, args) => {
  const p = spawn('npm', args, { stdio: 'inherit', shell: true });
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code}). Stopping.`);
    process.exit(code ?? 0);
  });
  return p;
};

const procs = [run('server', ['run', 'dev', '--workspace', 'apps/server']), run('web', ['run', 'dev', '--workspace', 'apps/web'])];
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
