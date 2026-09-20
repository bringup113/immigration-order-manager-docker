import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const mutationRoutes = [
  "app/api/data/[resource]/route.ts",
  "app/api/orders/[orderNo]/route.ts",
  "app/api/projects/[id]/route.ts",
  "app/api/projects/import/route.ts",
  "app/api/material-catalog/route.ts",
  "app/api/material-files/route.ts",
  "app/api/material-files/[id]/route.ts",
  "app/api/admin/users/route.ts",
  "app/api/admin/roles/route.ts",
  "app/api/auth/password/route.ts",
  "app/api/auth/mfa/route.ts",
  "app/api/auth/logout/route.ts",
  "app/api/auth/sessions/route.ts",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("every HTTP mutation route has server permission and audit enforcement", () => {
  for (const path of mutationRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(
      source,
      /requireMutationUser|isAllowedMutationOrigin/,
      `${path} has no server-side mutation guard`,
    );
    assert.match(source, /writeAudit\(/, `${path} has no audit write`);
  }
});

test("material catalog ordering is audited", () => {
  const source = readFileSync("app/api/material-catalog/route.ts", "utf8");
  assert.doesNotMatch(source, /action\s*!==\s*["']MOVE["']/);
  assert.match(source, /MATERIAL_CATALOG_\$\{action\}/);
});

test("read-only file access uses monitored best-effort audit", () => {
  const source = readFileSync("app/api/material-files/[id]/route.ts", "utf8");
  assert.match(source, /writeAuditBestEffort/);
  assert.match(source, /MATERIAL_FILE_PREVIEW/);
  assert.match(source, /MATERIAL_FILE_DOWNLOAD/);
});

test("file lifecycle and integrity checks are audited", () => {
  const upload = readFileSync("app/api/material-files/route.ts", "utf8");
  const lifecycle = readFileSync(
    "app/api/material-files/[id]/route.ts",
    "utf8",
  );
  const integrity = readFileSync(
    "app/api/admin/file-integrity/route.ts",
    "utf8",
  );
  const restore = readFileSync("scripts/restore-postgres.sh", "utf8");
  for (const action of ["MATERIAL_FILE_UPLOAD", "MATERIAL_FILE_REPLACE"])
    assert.match(upload, new RegExp(action));
  for (const action of ["MATERIAL_FILE_VOID", "MATERIAL_FILE_RESTORE"])
    assert.match(lifecycle, new RegExp(action));
  assert.match(integrity, /FILE_INTEGRITY_CHECK/);
  assert.match(restore, /'FILE_INTEGRITY_CHECK','SYSTEM','FAILURE'/);
});

test("cash history and formal closure actions are permission checked and audited", () => {
  const source = [
    readFileSync("app/api/orders/[orderNo]/route.ts", "utf8"),
    readFileSync("lib/order-action-policy.ts", "utf8"),
  ].join("\n");
  for (const action of [
    "finance.restore",
    "CASH_ENTRY_VOID",
    "CASH_ENTRY_RESTORE",
    "ORDER_CLOSE",
    "ORDER_REOPEN",
  ])
    assert.match(source, new RegExp(action));
  assert.match(source, /reopenOrder:\s*\{\s*permission:\s*"orders\.override"/);
});

test("owner assignment and every task lifecycle action are audited", () => {
  const source = [
    readFileSync("app/api/orders/[orderNo]/route.ts", "utf8"),
    readFileSync("lib/order-action-policy.ts", "utf8"),
  ].join("\n");
  assert.match(source, /assignOwner:\s*\{[^}]*label:\s*["']分配订单负责人["']/);
  for (const action of [
    "TASK_CREATE",
    "TASK_UPDATE",
    "TASK_COMPLETE",
    "TASK_REOPEN",
    "TASK_DELETE",
  ]) {
    assert.match(source, new RegExp(action));
  }
  assert.match(
    source,
    /changes:\s*\{\s*before,\s*after,\s*submitted:\s*auditBody\s*\}/,
  );
});

test("business UI uses the shared confirmation dialog instead of browser-native prompts", () => {
  for (const path of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(
      source,
      /window\.(confirm|prompt)\s*\(/,
      `${path} uses a browser-native confirmation prompt`,
    );
  }

  for (const path of [
    "components/order-detail.tsx",
    "app/projects/[id]/page.tsx",
    "app/agents/page.tsx",
    "app/channels/page.tsx",
    "app/settings/currencies/page.tsx",
    "app/settings/materials/page.tsx",
    "app/settings/users/page.tsx",
  ]) {
    assert.match(
      readFileSync(path, "utf8"),
      /<ConfirmDialog/,
      `${path} does not use the shared confirmation dialog`,
    );
  }
});

test("agent management is permissioned, audited, and protects the company-direct source", () => {
  const route = [
    readFileSync("app/api/data/[resource]/route.ts", "utf8"),
    readFileSync("lib/data-resource-policy.ts", "utf8"),
    readFileSync("lib/data-resource-mutations.ts", "utf8"),
  ].join("\n");
  const permissions = readFileSync("lib/permissions.ts", "utf8");
  const migration = readFileSync(
    "postgres/migrations/0021_agents_and_company_direct.sql",
    "utf8",
  );
  assert.match(
    route,
    /agents:\s*\{[^}]*readPermission:\s*["']agents\.read["']/,
  );
  assert.match(
    route,
    /agents:\s*\{[^}]*writePermission:\s*["']agents\.write["']/,
  );
  assert.match(route, /系统内置的“公司直营”必须保持启用/);
  assert.match(route, /agents:\s*\{[^}]*summary:\s*["']保存代理["']/);
  assert.match(permissions, /agents\.read/);
  assert.match(permissions, /agents\.write/);
  assert.match(migration, /'agt_company_direct','DIRECT','公司直营'/);
  assert.match(migration, /system_managed/);
});

test("session self-service and public owner MFA are enforced and audited", () => {
  const sessions = readFileSync("app/api/auth/sessions/route.ts", "utf8");
  const apiAuth = readFileSync("lib/api-auth.ts", "utf8");
  const dockerAuth = readFileSync("lib/docker-auth.ts", "utf8");
  const mfa = readFileSync("app/api/auth/mfa/route.ts", "utf8");
  assert.match(sessions, /requireMutationUser/);
  assert.match(sessions, /AUTH_SESSION_REVOKE_OTHERS/);
  assert.match(sessions, /writeAuditBestEffort/);
  assert.match(apiAuth, /MFA_SETUP_REQUIRED/);
  assert.match(mfa, /privilegedMfaPolicyEnabled/);
  assert.match(dockerAuth, /privilegedMfaPolicyEnabled\(\) && roleCode === "OWNER" && !mfaEnabled/);
  assert.doesNotMatch(dockerAuth, /roleCode === "OWNER" \|\| roleCode === "ADMIN"/);
  assert.match(mfa, /privilegedMfaPolicyEnabled\(\) && auth\.user\.roleCode === "OWNER"/);
});

test("configured public origin does not block same-host LAN mutations", () => {
  const apiAuth = readFileSync("lib/api-auth.ts", "utf8");
  assert.match(apiAuth, /requestOrigin\.origin === new URL\(configuredOrigin\)\.origin/);
  assert.match(apiAuth, /requestOrigin\.host === host/);
});

test("first-run owner is created by the user and the initialization is audited", () => {
  const login = readFileSync("app/api/auth/login/route.ts", "utf8");
  const auth = readFileSync("lib/docker-auth.ts", "utf8");
  const entrypoint = readFileSync("scripts/docker-entrypoint.mjs", "utf8");
  assert.match(login, /dockerOwnerSetupRequired/);
  assert.match(login, /createInitialDockerOwner/);
  assert.match(login, /name="confirm_password"/);
  assert.match(auth, /pg_advisory_xact_lock/);
  assert.match(auth, /USER_BOOTSTRAP/);
  assert.match(auth, /'role_owner',1,0,0/);
  assert.doesNotMatch(
    entrypoint,
    /admin-password|APP_INITIAL_USERNAME|APP_PASSWORD/,
  );
});

test("MFA setup renders a local QR code and keeps the manual fallback", () => {
  const profile = readFileSync("app/settings/profile/page.tsx", "utf8");
  assert.match(profile, /from "qrcode"/);
  assert.match(profile, /QRCode\.toDataURL/);
  assert.match(profile, /无法扫码？显示手动设置密钥/);
});

test("orders derive contract value from receivable plans", () => {
  const schema = readFileSync("postgres/migrations/0001_schema.sql", "utf8");
  const migration = readFileSync(
    "postgres/migrations/0018_order_plans_as_contract_value.sql",
    "utf8",
  );
  const service = readFileSync("lib/order-service.ts", "utf8");
  const detail = readFileSync("components/order-detail.tsx", "utf8");
  const lifecycle = readFileSync(
    "hooks/use-order-lifecycle-actions.ts",
    "utf8",
  );
  const page = readFileSync("app/orders/[id]/page.tsx", "utf8");
  assert.doesNotMatch(schema, /contract_amount_minor/);
  assert.match(migration, /DROP COLUMN IF EXISTS contract_amount_minor/);
  assert.doesNotMatch(service, /contractAmount|contract_amount_minor/);
  assert.doesNotMatch(detail, /合同总额|contract_amount_minor|updateContract/);
  assert.match(detail, /useOrderLifecycleActions/);
  assert.match(lifecycle, /action: "updateSignedAt"/);
  assert.match(page, /title="订单详情"/);
  assert.doesNotMatch(page, /title=\{id\}/);
});

test("passport MRZ is permissioned, audited, self-hosted, and tied to a fixed applicant material", () => {
  const permissions = readFileSync("lib/permissions.ts", "utf8");
  const orderRoute = [
    readFileSync("app/api/orders/[orderNo]/route.ts", "utf8"),
    readFileSync("lib/order-action-policy.ts", "utf8"),
    readFileSync("lib/order-mrz.ts", "utf8"),
  ].join("\n");
  const mrzScanRoute = readFileSync("app/api/mrz/scan/route.ts", "utf8");
  const uploadRoute = readFileSync("app/api/material-files/route.ts", "utf8");
  const migration = readFileSync(
    "postgres/migrations/0023_applicant_passport_mrz.sql",
    "utf8",
  );
  const newOrder = readFileSync("app/orders/new/page.tsx", "utf8");
  const details = [
    readFileSync("components/order-detail.tsx", "utf8"),
    readFileSync("components/order-detail-people-section.tsx", "utf8"),
  ].join("\n");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  for (const permission of ["applicants.write", "applicants.mrz"])
    assert.match(permissions, new RegExp(permission.replace(".", "\\.")));
  assert.match(orderRoute, /APPLICANT_MRZ_CONFIRM/);
  assert.match(
    mrzScanRoute,
    /requireMutationUser\(request, "applicants\.mrz"\)/,
  );
  assert.match(mrzScanRoute, /APPLICANT_MRZ_SCAN/);
  assert.match(mrzScanRoute, /include_raw=1/);
  assert.match(orderRoute, /rawMrz:\s*"\[已隐藏\]"/);
  assert.match(orderRoute, /system_code='PASSPORT_BIO_PAGE'/);
  assert.match(uploadRoute, /mrz_status='NOT_SCANNED'/);
  assert.match(migration, /CREATE TABLE applicant_mrz_records/);
  assert.match(migration, /order_materials_applicant_system_uq/);
  assert.match(newOrder, /recognizePassportFile/);
  assert.match(newOrder, /accept="\.pdf,\.jpg,\.jpeg,\.png,\.webp"/);
  assert.match(newOrder, /newApplicant\("DEPENDENT"\)/);
  assert.match(newOrder, /新增附属申请人/);
  assert.match(newOrder, /TooltipContent/);
  assert.match(details, /识别当前护照/);
  assert.match(dockerfile, /copy-pdf-assets/);
  assert.match(readFileSync("lib/passport-mrz.ts", "utf8"), /pdfjs-dist/);
  assert.match(readFileSync("lib/passport-mrz.ts", "utf8"), /findMrzLines/);
  assert.match(
    readFileSync("scripts/copy-pdf-assets.mjs", "utf8"),
    /pdf\.worker\.min\.mjs/,
  );
});

test("project packages are permission checked, versioned, transactional, and audited", () => {
  const exportRoute = readFileSync("app/api/projects/export/route.ts", "utf8");
  const importRoute = readFileSync("app/api/projects/import/route.ts", "utf8");
  const packageService = readFileSync("lib/project-package.ts", "utf8");
  assert.match(exportRoute, /projects\.export/);
  assert.match(exportRoute, /PROJECT_PACKAGE_EXPORT/);
  assert.match(importRoute, /projects\.import/);
  assert.match(importRoute, /PROJECT_PACKAGE_IMPORT/);
  assert.match(packageService, /migra-project-package/);
  assert.match(packageService, /formatVersion/);
  assert.match(packageService, /pg_advisory_xact_lock/);
  assert.match(packageService, /return db\.transaction/);
  assert.doesNotMatch(packageService, /INSERT INTO orders/);
});
