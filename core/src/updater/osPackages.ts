import fs from "node:fs/promises";
import path from "node:path";

const packageName = /^[a-z0-9.+-]+$/;

export async function releaseOsPackages(staging: string): Promise<string[]> {
  const manifest = path.join(staging, "deploy", "os-packages.txt");
  let raw: string;
  try {
    raw = await fs.readFile(manifest, "utf8");
  } catch {
    return [];
  }

  const packages = raw
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);

  const unique = Array.from(new Set(packages));
  const invalid = unique.find((pkg) => !packageName.test(pkg));
  if (invalid) throw new Error(`invalid_os_package_name: ${invalid}`);
  return unique;
}
