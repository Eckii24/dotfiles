export class SessionAllowList {
  private allowedCommands = new Set<string>();

  private key(scope: string, command: string): string {
    return `${scope}\u0000${command}`;
  }

  isAllowed(scope: string, command: string): boolean {
    return this.allowedCommands.has(this.key(scope, command));
  }

  allowCommand(scope: string, command: string): void {
    this.allowedCommands.add(this.key(scope, command));
  }

  clear(): void {
    this.allowedCommands.clear();
  }

  get size(): number {
    return this.allowedCommands.size;
  }
}
