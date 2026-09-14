import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const backupScript = resolve("scripts/postgres-backup-once.sh");
const restoreDrillScript = resolve("scripts/restore-drill-postgres.sh");

function executable(path, content) {
  writeFileSync(path, content, { mode: 0o700 });
  chmodSync(path, 0o700);
}

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
