import { existsSync } from "node:fs";
import { basename } from "node:path";
import { spawn } from "node:child_process";

export type PreflightDecision = "allow" | "confirm" | "deny";

export interface PreflightVerdict {
  decision: PreflightDecision;
  reason: string;
  concerns: string[];
}

export interface BuildPreflightPromptInput {
  command: string;
  cwd: string;
  effectiveCwd: string;
  recentContext: string;
  gate1Reason: string;
  gate1Hints: string[];
}

export interface RunPreflightJudgeInput {
  cwd: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const DEFAULT_PREFLIGHT_MODEL = "github-copilot/claude-haiku-4.5";

export function buildPreflightPrompt(input: BuildPreflightPromptInput): string {
  const parts: string[] = [];
  parts.push("You are the Gate-2 bash preflight judge for Pi guardrails.");
  parts.push("Decide whether this bash command is contextually appropriate and safe.");
  parts.push("");
  parts.push("You must judge whether the command:");
  parts.push("- is sensible in the current task context");
  parts.push("- avoids unintended damage");
  parts.push("- does not exfiltrate secrets or sensitive data");
  parts.push("- does not perform suspicious remote actions");
  parts.push("");
  parts.push("## Command");
  parts.push(input.command);
  parts.push("");
  parts.push("## Working directory");
  parts.push(`cwd: ${input.cwd}`);
  parts.push(`effectiveCwd: ${input.effectiveCwd}`);
  parts.push("");
  parts.push("## Recent context");
  parts.push(input.recentContext || "(no recent context available)");
  parts.push("");
  parts.push("## Gate 1 summary");
  parts.push(input.gate1Reason);
  parts.push(`Hints: ${input.gate1Hints.length > 0 ? input.gate1Hints.join(", ") : "none"}`);
  parts.push("");
  parts.push("Return exactly one structured verdict block and nothing else:");
  parts.push("[PREFLIGHT_VERDICT]");
  parts.push("DECISION: ALLOW|CONFIRM|DENY");
  parts.push("REASON: one concise sentence");
  parts.push("CONCERNS: semicolon-separated list, or 'none'");
  parts.push("[/PREFLIGHT_VERDICT]");
  parts.push("");
  parts.push("Use ALLOW when the command fits the task and is not meaningfully dangerous.");
  parts.push("Use CONFIRM when the command might be legitimate but deserves explicit user review.");
  parts.push("Use DENY when it is harmful, suspicious, or likely to exfiltrate secrets/data.");
  return parts.join("\n");
}

export function parsePreflightVerdict(output: string): PreflightVerdict | undefined {
  const match = output.match(/\[PREFLIGHT_VERDICT\]\s*DECISION:\s*(ALLOW|CONFIRM|DENY)\s*REASON:\s*([\s\S]*?)\s*CONCERNS:\s*([\s\S]*?)\s*\[\/PREFLIGHT_VERDICT\]/i);
  if (!match) return undefined;

  const concernsText = match[3]!.trim();
  const concerns = concernsText.toLowerCase() === "none"
    ? []
    : concernsText.split(";").map((item) => item.trim()).filter(Boolean);

  return {
    decision: match[1]!.toLowerCase() as PreflightDecision,
    reason: match[2]!.trim(),
    concerns,
  };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };
  return { command: "pi", args };
}

export async function runPreflightJudge(input: RunPreflightJudgeInput): Promise<PreflightVerdict> {
  return new Promise<PreflightVerdict>((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(new Error("Preflight aborted"));
      return;
    }

    const args = [
      "-p",
      input.prompt,
      "--model",
      input.model,
      "--no-session",
      "--no-tools",
      "--thinking-level",
      "off",
    ];

    const invocation = getPiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: input.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PI_SUBAGENT: "1" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (!proc.killed) proc.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 2000);
      killTimer.unref?.();
      reject(new Error(`Preflight judge timed out after ${input.timeoutMs ?? 30000}ms`));
    }, input.timeoutMs ?? 30000);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const onAbort = () => {
      if (!proc.killed) proc.kill("SIGTERM");
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    proc.on("close", (code) => {
      clearTimeout(timeoutHandle);
      input.signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;

      if (input.signal?.aborted) {
        reject(new Error("Preflight aborted"));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Preflight judge exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      const verdict = parsePreflightVerdict(stdout);
      if (!verdict) {
        reject(new Error(`Preflight judge did not return a structured verdict. Output: ${stdout.slice(0, 500)}`));
        return;
      }

      resolve(verdict);
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutHandle);
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
