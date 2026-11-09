import fs from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

function loadParentEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.resolve(process.cwd(), "..", name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadParentEnv();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: [],
  experimental: {
    optimizePackageImports: ["lightweight-charts"],
  },
};

export default nextConfig;
