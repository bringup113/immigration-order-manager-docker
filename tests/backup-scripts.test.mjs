import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const backupScript = resolve("scripts/postgres-backup-once.sh");
const restoreDrillScript = resolve("scripts/restore-drill-postgres.sh");
const restoreScript = resolve("scripts/restore-postgres.sh");
const verifyBackupScript = resolve("scripts/verify-postgres-backup.sh");
const verifyDeploymentScript = resolve("scripts/verify-deployment-security.sh");
const executableScripts = [
  "scripts/backup-postgres.sh",
  "scripts/postgres-backup-loop.sh",
  "scripts/postgres-backup-once.sh",
  "scripts/restore-drill-postgres.sh",
  "scripts/restore-postgres.sh",
  "scripts/verify-deployment-security.sh",
  "scripts/verify-postgres-backup.sh",
];

function executable(path, content) {
  writeFileSync(path, content, { mode: 0o700 });
  chmodSync(path, 0o700);
}

test("operator shell scripts retain executable permissions", () => {
  for (const script of executableScripts) {
    assert.notEqual(
      statSync(resolve(script)).mode & 0o111,
      0,
      `${script} must be executable`,
    );
  }
});

test("failed pg_dump leaves no success backup or temporary file", () => {
  const root = mkdtempSync(join(tmpdir(), "migra-backup-failure-"));
  try {
    const fail = join(root, "pg-dump-fail");
    executable(fail, "#!/bin/sh\nexit 9\n");
    const result = spawnSync("sh", [backupScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        BACKUP_DIR: root,
        BACKUP_PREFIX: "failure",
        PG_DUMP_BIN: fail,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /backup_dump_failed/);
    assert.doesNotMatch(result.stdout + result.stderr, /backup_success/);
    assert.deepEqual(
      readdirSync(root).filter(
        (name) => name.endsWith(".dump") || name.includes(".tmp"),
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only a large custom dump with a table-data catalog is atomically published", () => {
  const root = mkdtempSync(join(tmpdir(), "migra-backup-success-"));
  try {
    const dump = join(root, "pg-dump-ok");
    const restore = join(root, "pg-restore-ok");
    executable(
      dump,
      `#!/bin/sh
output=""
for value in "$@"; do case "$value" in --file=*) output="\${value#--file=}" ;; esac; done
[ -n "$output" ] || exit 2
dd if=/dev/zero of="$output" bs=5000 count=1 2>/dev/null
`,
    );
    executable(
      restore,
      "#!/bin/sh\necho '1; 0 0 TABLE DATA public orders migra'\n",
    );
    const result = spawnSync("sh", [backupScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        BACKUP_DIR: root,
        BACKUP_PREFIX: "success",
        PG_DUMP_BIN: dump,
        PG_RESTORE_BIN: restore,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /backup_success/);
    const files = readdirSync(root).filter((name) => name.endsWith(".dump"));
    assert.equal(files.length, 1);
    assert.equal(readFileSync(join(root, files[0])).byteLength, 5000);
    assert.deepEqual(
      readdirSync(root).filter((name) => name.includes(".tmp")),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed backup contender never removes the active backup lock", () => {
  const root = mkdtempSync(join(tmpdir(), "migra-backup-lock-"));
  const lock = join(root, ".contention-backup.lock");
  try {
    mkdirSync(lock);
    const result = spawnSync("sh", [backupScript], {
      encoding: "utf8",
      env: { ...process.env, BACKUP_DIR: root, BACKUP_PREFIX: "contention" },
    });
    assert.equal(result.status, 3);
    assert.equal(existsSync(lock), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed transactional restore keeps the application stopped", () => {
  const root = mkdtempSync(join(tmpdir(), "migra-restore-failure-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    mkdirSync(join(root, "backups", "postgres"), { recursive: true });
    copyFileSync(restoreScript, join(root, "scripts", "restore-postgres.sh"));
    executable(join(root, "scripts", "verify-postgres-backup.sh"), "#!/bin/sh\nexit 0\n");
    const dump = join(root, "backups", "postgres", "test.dump");
    writeFileSync(dump, Buffer.alloc(5000));
    executable(join(root, "bin", "docker"), `#!/bin/sh
echo "$*" >> "$REVIEW_LOG"
case "$*" in *"exec -T postgres pg_restore"*) exit 9 ;; esac
exit 0
`);
    const log = join(root, "docker.log");
    const result = spawnSync("bash", [join(root, "scripts", "restore-postgres.sh"), dump], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        CONFIRM_RESTORE: "YES",
        REVIEW_LOG: log,
      },
    });
    assert.equal(result.status, 9);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /--single-transaction/);
    assert.doesNotMatch(calls, /compose start migra/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restore drill runs migrations and integrity checks inside Docker", () => {
  const script = readFileSync(restoreDrillScript, "utf8");
  assert.match(
    script,
    /docker compose run --rm --no-deps[\s\S]*postgres_migrate/,
  );
  assert.match(
    script,
    /docker compose exec -T[\s\S]*migra sh -eu -c[\s\S]*check-file-integrity/,
  );
  assert.doesNotMatch(script, /node --env-file=\.env/);
  assert.match(script, /dropdb --if-exists --force/);
  assert.match(script, /count\(\*\) FROM projects/);
  assert.match(script, /count\(\*\) FROM exchange_rates/);
});

test("deployment verification supports isolated Compose projects and backup roots", () => {
  const deployment = readFileSync(verifyDeploymentScript, "utf8");
  const backup = readFileSync(verifyBackupScript, "utf8");
  assert.match(deployment, /docker compose ps -q migra/);
  assert.doesNotMatch(deployment, /docker inspect migra-order-manager/);
  assert.match(backup, /BACKUP_ROOT/);
  assert.match(backup, /BACKUP_CONTAINER_ROOT/);
});
