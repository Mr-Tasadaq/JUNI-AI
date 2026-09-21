import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("production deployment hardening is present", async () => {
  const [vercel, ci, codeql, dependabot, validator, pkg, securityTxt] = await Promise.all([
    readFile(join(root, "vercel.json"), "utf8"),
    readFile(join(root, ".github/workflows/ci.yml"), "utf8"),
    readFile(join(root, ".github/workflows/codeql.yml"), "utf8"),
    readFile(join(root, ".github/dependabot.yml"), "utf8"),
    readFile(join(root, "scripts/verify-production-config.js"), "utf8"),
    readFile(join(root, "package.json"), "utf8"),
    readFile(join(root, ".well-known/security.txt"), "utf8"),
  ]);

  const headers = JSON.parse(vercel);
  const configuredHeaders = headers.headers?.[0]?.headers ?? [];
  const headerMap = new Map(configuredHeaders.map((item) => [item.key, item.value]));

  assert.equal(headers.buildCommand, "npm run verify:production");
  assert.equal(headerMap.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(headerMap.get("X-Frame-Options"), "DENY");
  assert.match(headerMap.get("Content-Security-Policy"), /object-src 'none'/);
  assert.match(headerMap.get("Content-Security-Policy"), /frame-src 'none'/);
  assert.match(headerMap.get("Content-Security-Policy"), /upgrade-insecure-requests/);

  assert.match(ci, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(ci, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(ci, /npm run audit:security/);
  assert.match(codeql, /github\/codeql-action\/init@v4/);
  assert.match(codeql, /github\/codeql-action\/analyze@v4/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);

  assert.match(validator, /JUNI_API_TOKEN/);
  assert.match(validator, /JUNI_ALLOWED_ORIGIN/);
  assert.match(validator, /JUNI_DATABASE_URL/);
  assert.match(validator, /JUNI_IDENTITY_DEFAULT_TENANT_ID/);
  assert.match(pkg, /"verify:production": "node scripts\/verify-production-config\.js"/);
  assert.match(securityTxt, /Contact: https:\/\/github\.com\/Mr-Tasadaq\/JUNI-AI\/security\/advisories\/new/);
});
