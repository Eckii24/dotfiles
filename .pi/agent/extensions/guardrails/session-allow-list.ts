export class SessionAllowList {
  private allowedCommands = new Set<string>();

  private key(scope: string, command: string): string {
    return `${scope}\u0000${command}`;
  }

  private parseKey(key: string): { scope: string; command: string } {
    const index = key.indexOf("\u0000");
    return {
      scope: key.slice(0, index),
      command: key.slice(index + 1),
    };
  }

  isAllowed(scope: string, command: string): boolean {
    return this.allowedCommands.has(this.key(scope, command));
  }

  allowCommand(scope: string, command: string): void {
    this.allowedCommands.add(this.key(scope, command));
  }

  commandsForScope(scope: string): string[] {
    return [...this.allowedCommands]
      .map((key) => this.parseKey(key))
      .filter((item) => item.scope === scope)
      .map((item) => item.command);
  }

  clear(): void {
    this.allowedCommands.clear();
  }

  get size(): number {
    return this.allowedCommands.size;
  }
}
