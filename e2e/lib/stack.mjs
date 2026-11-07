// Everything one run needs, private to that run: a Redis and a Postgres that die
// with it, a fresh build of the tree under test, and a server that can be killed
// and started again. Nothing here touches the shared stack.
import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const run = (cmd, args, cwd) => exec(cmd, args, { cwd, maxBuffer: 1 << 26 });

const hostPort = async (name, port) => {
  const { stdout } = await run('docker', ['port', name, String(port)]);
  return stdout.trim().split('\n')[0].split(':').at(-1);
};

export const startContainers = async (id) => {
  const redis = `s2g-flows-redis-${id}`;
  const postgres = `s2g-flows-pg-${id}`;
  await run('docker', ['run', '-d', '--rm', '--name', redis, '-p', '127.0.0.1::6379', 'redis:8-alpine']);
  await run('docker', ['run', '-d', '--rm', '--name', postgres, '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_USER=s2g', '-e', 'POSTGRES_PASSWORD=s2g', '-e', 'POSTGRES_DB=s2g',
    '--tmpfs', '/var/lib/postgresql/data', 'postgres:17-alpine', '-c', 'fsync=off']);
  for (let i = 0; ; i += 1) {
    const ready = await run('docker', ['exec', postgres, 'pg_isready', '-U', 's2g', '-h', '127.0.0.1']).catch(() => null);
    if (ready) break;
    if (i > 100) throw new Error('postgres did not start');
    await sleep(200);
  }
  return { redis, postgres, redisPort: await hostPort(redis, 6379), postgresPort: await hostPort(postgres, 5432) };
};

export const stopContainers = ({ redis, postgres }) =>
  Promise.allSettled([run('docker', ['rm', '-f', redis]), run('docker', ['rm', '-f', postgres])]);

/** CI's service containers, when the job names them. They are the job's, so close leaves them. */
const attachContainers = async () => {
  const { FLOWS_REDIS_CONTAINER: redis, FLOWS_POSTGRES_CONTAINER: postgres } = process.env;
  if (!redis || !postgres) return null;
  return { redis, postgres, attached: true, redisPort: await hostPort(redis, 6379), postgresPort: await hostPort(postgres, 5432) };
};

const sampleVideo = async (cache, file, seconds) => {
  const out = path.join(cache, file);
  if (existsSync(out)) return out;
  await mkdir(cache, { recursive: true });
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'veryfast', '-g', '30',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '48k', '-shortest', '-movflags', '+faststart', out]);
  return out;
};

const build = async (tree, work, cache) => {
  const webDir = path.join(work, 'web');
  const binary = path.join(work, 's2g');
  if (!existsSync(path.join(tree, 'web/node_modules'))) await run('npm', ['ci'], path.join(tree, 'web'));
  await Promise.all([
    run('npx', ['vite', 'build', '--outDir', webDir, '--emptyOutDir'], path.join(tree, 'web')),
    run('go', ['build', '-o', binary, './cmd/s2g'], path.join(tree, 'server')),
  ]);
  const [long, short] = await Promise.all([sampleVideo(cache, 'sample.mp4', 300), sampleVideo(cache, 'short.mp4', 8)]);
  await Promise.all([cp(long, path.join(webDir, 'sample.mp4')), cp(short, path.join(webDir, 'short.mp4'))]);
  return { webDir, binary };
};

/** tree is the checkout under test. youtubeUrl is the fixture API, or Google's if unset. */
export const startStack = async ({ tree, port, cache, youtubeUrl, youtubeKey }) => {
  const id = `${process.pid}-${port}`;
  const work = await mkdtemp(path.join(tmpdir(), 's2g-flows-'));
  // Named, as people's are: the server sends a page opened at an IP on to its name.
  const base = `http://localhost:${port}`;
  const [{ webDir, binary }, containers] = await Promise.all([
    build(tree, work, cache),
    attachContainers().then((found) => found ?? startContainers(id)),
  ]);
  const { redis, postgres, redisPort, postgresPort, attached } = containers;

  let server = null;
  const log = createWriteStream(path.join(work, 'server.log'), { flags: 'a' });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    APP_ENV: 'dev',
    HTTP_ADDR: `127.0.0.1:${port}`,
    PUBLIC_ORIGIN: base,
    WEB_DIR: webDir,
    DATABASE_URL: `postgres://s2g:s2g@127.0.0.1:${postgresPort}/s2g?sslmode=disable`,
    REDIS_ADDR: `127.0.0.1:${redisPort}`,
    // Nothing listens here, and the sink only logs that. Runs must not reach real telemetry.
    CLICKHOUSE_HTTP: 'http://s2g:s2g@127.0.0.1:9/s2g',
    ALLOW_DIRECT_MEDIA: 'true',
    // Each flow gets its own address, so one flow's limits can't reach another.
    TRUSTED_PROXY: 'true',
    YOUTUBE_API_KEY: youtubeKey,
    ...(youtubeUrl ? { YOUTUBE_BASE_URL: youtubeUrl } : {}),
  };

  const ready = async () => {
    for (let i = 0; i < 300; i += 1) {
      if (!server || server.exitCode !== null) throw new Error(`server exited, see ${work}/server.log`);
      if (await fetch(`${base}/readyz`).then((r) => r.ok, () => false)) return;
      await sleep(100);
    }
    throw new Error('server did not become ready');
  };

  const stack = {
    base,
    work,
    log: path.join(work, 'server.log'),
    /** It runs from the temporary folder, so no .env.local can leak a real key into a run. */
    async start() {
      server = spawn(binary, ['serve'], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stdout.pipe(log, { end: false });
      server.stderr.pipe(log, { end: false });
      await ready();
    },
    async stop(signal = 'SIGTERM') {
      if (!server) return;
      const done = new Promise((resolve) => server.once('exit', resolve));
      server.kill(signal);
      await done;
      server = null;
    },
    async sql(query) {
      const { stdout } = await run('docker', ['exec', postgres, 'psql', '-U', 's2g', '-d', 's2g', '-tA', '-c', query]);
      return stdout.trim();
    },
    async redis(...args) {
      const { stdout } = await run('docker', ['exec', redis, 'redis-cli', ...args]);
      return stdout.trim();
    },
    async close({ keepLogs = false } = {}) {
      await stack.stop().catch(() => {});
      if (!attached) await stopContainers(containers);
      if (!keepLogs) await rm(work, { recursive: true, force: true });
    },
  };
  await stack.start();
  return stack;
};
