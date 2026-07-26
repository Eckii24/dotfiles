/** Minimal cross-extension activation contract. No Gondolin runtime import here. */
export function isGondolinSandboxRequested(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes("--sandbox") || env.PI_SANDBOX === "gondolin";
}
