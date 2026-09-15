import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const prepareScript = resolve("scripts/prepare-docker-env.mjs");
const exportCredentialsScript = resolve(
  "scripts/export-integration-test-credentials.mjs",
);

test("docker preparation creates writable bind-mount directories", () => {
  const root = mkdtempSync(join(tmpdir(), "migra-docker-prepare-"));
  const envPath = join(root, ".env");
  try {
    writeFileSync(envPath, "POSTGRES_PASSWORD=CiOnly-Strong-Owner-Password\n");
    const result = spawnSync(process.execPath, [prepareScript, envPath], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /挂载目录已准备/);
    assert.equal(statSync(join(root, "data/files")).isDirectory(), true);
    assert.equal(statSync(join(root, "backups/postgres")).isDirectory(), true);
    assert.equal(statSync(envPath).mode & 0o777, 0o600);

    const env = readFileSync(envPath, "utf8");
    assert.match(env, /^APP_UID=\d+$/m);
    assert.match(env, /^APP_GID=\d+$/m);
    assert.match(env, /^POSTGRES_RUNTIME_PASSWORD=\S+$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CI credentials are exported to later steps and the password is masked", () => {
  const root = mkdtempSync(join(tmpdir(), "migra-ci-credentials-"));
  const credentialPath = join(root, "credentials.txt");
  const githubEnvironmentPath = join(root, "github-env");
  try {
    writeFileSync(
      credentialPath,
      "账号：migra_integration_test\n密码：Temporary-Test-Password\n",
    );
    writeFileSync(githubEnvironmentPath, "");
    const result = spawnSync(
      process.execPath,
      [exportCredentialsScript, credentialPath],
      {
        encoding: "utf8",
        env: { ...process.env, GITHUB_ENV: githubEnvironmentPath },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^::add-mask::Temporary-Test-Password$/m);
    assert.equal(
      readFileSync(githubEnvironmentPath, "utf8"),
      "MIGRA_TEST_USERNAME=migra_integration_test\n" +
        "MIGRA_TEST_PASSWORD=Temporary-Test-Password\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
