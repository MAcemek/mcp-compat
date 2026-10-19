import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** Every server process that is still running, so that a signal handler can stop them all. */
const running = new Set<ChildProcessWithoutNullStreams>();

/**
 * Starts `command` through the platform shell (/bin/sh -c on POSIX, cmd.exe /d /s /c on
 * Windows), so that it runs exactly as the user would type it. On POSIX the shell leads a new
 * process group, which lets killProcessTree stop the server and everything it started.
 */
export function spawnShellCommand(
  command: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): ChildProcessWithoutNullStreams {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: platform !== 'win32',
  });
  running.add(child);
  child.once('exit', () => running.delete(child));
  child.once('error', () => running.delete(child));
  return child;
}

export function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Resolves true when the process exits within `ms`, false otherwise. */
export function waitForExit(child: ChildProcessWithoutNullStreams, ms: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, ms);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

function taskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('exit', () => resolve());
    killer.once('error', () => resolve());
  });
}

/**
 * Stops the process and all of its descendants. POSIX: SIGTERM to the process group, then
 * SIGKILL after 500 ms. Windows: taskkill /T /F, which walks the process tree.
 */
export async function killProcessTree(
  child: ChildProcessWithoutNullStreams,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (platform === 'win32') {
    if (!hasExited(child)) await taskkill(pid);
  } else {
    signalGroup(pid, 'SIGTERM');
    await waitForExit(child, 500);
    signalGroup(pid, 'SIGKILL');
  }
  if (!(await waitForExit(child, 2000))) child.kill('SIGKILL');
}

/**
 * Stops the process gracefully the way the stdio transport describes: close stdin, wait up to
 * `graceMs` for it to exit, then kill the whole tree. On POSIX the process group is always sent
 * SIGKILL at the end so that nothing the server started is left behind.
 */
export async function shutdownProcess(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  child.stdin.end();
  if (graceMs > 0 && (await waitForExit(child, graceMs))) {
    if (platform !== 'win32' && child.pid !== undefined) signalGroup(child.pid, 'SIGKILL');
    return;
  }
  await killProcessTree(child, platform);
}

/** Synchronously kills every running server tree. Used by the CLI's SIGINT and SIGTERM handlers. */
export function killAllProcessTreesSync(platform: NodeJS.Platform = process.platform): void {
  for (const child of running) {
    const pid = child.pid;
    if (pid === undefined || hasExited(child)) continue;
    if (platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      signalGroup(pid, 'SIGKILL');
    }
  }
  running.clear();
}

export function runningProcessCount(): number {
  return running.size;
}
