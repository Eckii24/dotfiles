import * as path from "node:path";

export const GUEST_WORKSPACE = "/workspace";

export type RuntimeState = "idle" | "starting" | "running" | "failed" | "stopped";

export interface StartableVm {
  readonly id: string;
  start(): Promise<void>;
  close?(): Promise<void>;
}

export class SandboxRuntime<T extends StartableVm> {
  state: RuntimeState = "idle";
  error: unknown;
  private vm: T | undefined;
  private startup: Promise<T> | undefined;
  private stopped = false;
  private closePromise: Promise<void> | undefined;
  private readonly createVm: () => Promise<T>;

  constructor(createVm: () => Promise<T>) {
    this.createVm = createVm;
  }

  ensureStarted(): Promise<T> {
    if (this.startup) return this.startup;
    if (this.stopped) return Promise.reject(new Error("sandbox runtime is stopped"));
    if (this.vm) return Promise.resolve(this.vm);
    this.state = "starting";
    this.startup = (async () => {
      try {
        const vm = await this.createVm();
        this.vm = vm;
        if (this.stopped) {
          await vm.close?.();
          throw new Error("sandbox runtime is stopped");
        }
        await vm.start();
        if (this.stopped) throw new Error("sandbox runtime is stopped");
        this.state = "running";
        return vm;
      } catch (error) {
        this.error = error;
        this.state = this.stopped ? "stopped" : "failed";
        throw error;
      }
    })();
    return this.startup;
  }

  /** Stop the VM even when shutdown races its asynchronous startup. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.stopped = true;
    const vm = this.vm;
    this.closePromise = (async () => {
      await vm?.close?.();
      this.state = "stopped";
    })();
    return this.closePromise;
  }
}

export interface SandboxMount {
  hostPath: string;
  guestPath: string;
  readOnly: boolean;
}

export function mapHostPath(hostPath: string, mounts: readonly SandboxMount[]): string {
  if (!path.isAbsolute(hostPath)) {
    throw new Error(`unmapped host path: ${hostPath}`);
  }
  const normalized = path.resolve(hostPath);
  const candidates = [...mounts].sort((a, b) => b.hostPath.length - a.hostPath.length);
  for (const mount of candidates) {
    const root = path.resolve(mount.hostPath);
    const relative = path.relative(root, normalized);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      return relative === ""
        ? mount.guestPath
        : path.posix.join(mount.guestPath, ...relative.split(path.sep));
    }
  }
  throw new Error(`unmapped host path: ${hostPath}`);
}

export function isSandboxRequested(
  cliFlag: boolean | string | undefined,
  env: NodeJS.ProcessEnv,
): boolean {
  return cliFlag === true || env.PI_SANDBOX === "gondolin";
}
