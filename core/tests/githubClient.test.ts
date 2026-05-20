import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient } from "../src/updater/githubClient.js";

type Release = {
  tag_name: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  tarball_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

function withFetch<T>(releases: Release[], fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => releases,
  })) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("latestForChannel picks the topmost non-draft release matching the channel", async () => {
  await withFetch(
    [
      {
        tag_name: "v1.2.3",
        published_at: "2026-05-20T10:00:00Z",
        prerelease: false,
        draft: false,
        tarball_url: "https://api.github.com/repos/x/y/tarball/v1.2.3",
        assets: [],
      },
    ],
    async () => {
      const gh = new GitHubClient("x/y");
      const r = await gh.latestForChannel("stable");
      assert.equal(r?.tag, "v1.2.3");
      assert.equal(r?.tarballUrl, "https://api.github.com/repos/x/y/tarball/v1.2.3");
      assert.equal(r?.isBuiltAsset, false);
    },
  );
});

test("latestForChannel prefers a uploaded built tarball over the source tarball", async () => {
  await withFetch(
    [
      {
        tag_name: "v2.0.0",
        published_at: "2026-05-20T10:00:00Z",
        prerelease: false,
        draft: false,
        tarball_url: "https://api.github.com/repos/x/y/tarball/v2.0.0",
        assets: [
          {
            name: "frame-v2.0.0.tar.gz",
            browser_download_url: "https://github.com/x/y/releases/download/v2.0.0/frame-v2.0.0.tar.gz",
          },
          {
            name: "release.asc",
            browser_download_url: "https://github.com/x/y/releases/download/v2.0.0/release.asc",
          },
        ],
      },
    ],
    async () => {
      const gh = new GitHubClient("x/y");
      const r = await gh.latestForChannel("stable");
      assert.equal(
        r?.tarballUrl,
        "https://github.com/x/y/releases/download/v2.0.0/frame-v2.0.0.tar.gz",
      );
      assert.equal(r?.isBuiltAsset, true);
      assert.equal(
        r?.signatureAssetUrl,
        "https://github.com/x/y/releases/download/v2.0.0/release.asc",
      );
    },
  );
});

test("stable channel skips beta releases", async () => {
  await withFetch(
    [
      {
        tag_name: "v1.0.0-beta.4",
        published_at: "2026-05-21T10:00:00Z",
        prerelease: true,
        draft: false,
        tarball_url: "x",
        assets: [],
      },
      {
        tag_name: "v0.9.0",
        published_at: "2026-05-20T10:00:00Z",
        prerelease: false,
        draft: false,
        tarball_url: "y",
        assets: [],
      },
    ],
    async () => {
      const gh = new GitHubClient("x/y");
      const r = await gh.latestForChannel("stable");
      assert.equal(r?.tag, "v0.9.0");
    },
  );
});

test("beta channel returns the first non-draft (including beta) entry", async () => {
  await withFetch(
    [
      {
        tag_name: "v1.0.0-beta.4",
        published_at: "2026-05-21T10:00:00Z",
        prerelease: true,
        draft: false,
        tarball_url: "x",
        assets: [],
      },
      {
        tag_name: "v0.9.0",
        published_at: "2026-05-20T10:00:00Z",
        prerelease: false,
        draft: false,
        tarball_url: "y",
        assets: [],
      },
    ],
    async () => {
      const gh = new GitHubClient("x/y");
      const r = await gh.latestForChannel("beta");
      assert.equal(r?.tag, "v1.0.0-beta.4");
      assert.equal(r?.prerelease, true);
    },
  );
});

test("drafts are skipped on both channels", async () => {
  await withFetch(
    [
      {
        tag_name: "v3.0.0",
        published_at: "2026-05-21T10:00:00Z",
        prerelease: false,
        draft: true,
        tarball_url: "x",
        assets: [],
      },
      {
        tag_name: "v2.9.0",
        published_at: "2026-05-20T10:00:00Z",
        prerelease: false,
        draft: false,
        tarball_url: "y",
        assets: [],
      },
    ],
    async () => {
      const gh = new GitHubClient("x/y");
      const r = await gh.latestForChannel("stable");
      assert.equal(r?.tag, "v2.9.0");
    },
  );
});
