import { sub } from "../util/logger.js";

const log = sub("updater.github");

export type ReleaseInfo = {
  tag: string;
  publishedAt: string;
  prerelease: boolean;
  tarballUrl: string;
  signatureAssetUrl?: string;
  isBuiltAsset?: boolean;
};

export class GitHubClient {
  constructor(private repo: string) {}

  async latestForChannel(channel: "stable" | "beta"): Promise<ReleaseInfo | null> {
    const url = `https://api.github.com/repos/${this.repo}/releases?per_page=20`;
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "github release list failed");
      return null;
    }
    const list = (await res.json()) as Array<{
      tag_name: string;
      published_at: string;
      prerelease: boolean;
      draft: boolean;
      tarball_url: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    }>;
    for (const r of list) {
      if (r.draft) continue;
      const isBeta = r.prerelease || /-beta\./.test(r.tag_name);
      if (channel === "stable" && isBeta) continue;
      // Prefer a uploaded built tarball if present (named
      // frame-<tag>.tar.gz) — its checksum and signature match what the
      // release workflow signed in CI. Fall back to GitHub's
      // auto-generated source tarball otherwise.
      const builtAsset = r.assets.find((a) => /^frame-.*\.tar\.gz$/.test(a.name));
      const sigAsset = r.assets.find((a) => a.name === "release.asc");
      return {
        tag: r.tag_name,
        publishedAt: r.published_at,
        prerelease: isBeta,
        tarballUrl: builtAsset?.browser_download_url ?? r.tarball_url,
        signatureAssetUrl: sigAsset?.browser_download_url,
        isBuiltAsset: Boolean(builtAsset),
      };
    }
    return null;
  }

  async downloadTarball(url: string, dest: string): Promise<void> {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
      throw new Error(`tarball download failed: HTTP ${res.status}`);
    }
    const fs = await import("node:fs");
    const { Writable } = await import("node:stream");
    const { pipeline } = await import("node:stream/promises");
    const stream = fs.createWriteStream(dest);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, Writable.toWeb(stream) as never);
  }
}
