import fs from "node:fs";
import path from "node:path";

export function dataDir(): string {
  const p = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
  return p;
}
