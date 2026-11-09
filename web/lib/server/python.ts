import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function resolvePython(): string {
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN)) {
    return process.env.PYTHON_BIN;
  }
  // Check virtual environment in root
  const candidates = [
    path.resolve(process.cwd(), "..", ".venv", "Scripts", "python.exe"),
    path.resolve(process.cwd(), ".venv", "Scripts", "python.exe"),
    path.resolve(process.cwd(), "..", ".venv", "bin", "python"),
    path.resolve(process.cwd(), ".venv", "bin", "python"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "python";
}

function resolveScript(script: string): { fullPath: string; cwd: string } {
  const root = path.resolve(process.cwd(), "..");
  const candidate1 = path.resolve(root, script);
  if (fs.existsSync(candidate1)) return { fullPath: candidate1, cwd: root };
  const candidate2 = path.resolve(process.cwd(), script);
  if (fs.existsSync(candidate2)) return { fullPath: candidate2, cwd: process.cwd() };
  return { fullPath: script, cwd: root };
}

export function spawnPython(script: string, args: string[]): ChildProcess {
  const py = resolvePython();
  const { fullPath, cwd } = resolveScript(script);
  return spawn(py, [fullPath, ...args], {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
}

export async function runJson<T>(
  script: string,
  args: string[],
  options?: { timeoutMs?: number }
): Promise<T> {
  const timeoutMs = options?.timeoutMs || 60000;
  return new Promise((resolve, reject) => {
    const child = spawnPython(script, args);
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Python process timed out after ${timeoutMs}ms: ${script}`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(
          new Error(`Python ${script} failed with code ${code}: ${stderr || stdout}`)
        );
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed as T);
      } catch (err) {
        reject(new Error(`Failed to parse Python JSON output: ${stdout.slice(0, 300)}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
