#!/usr/bin/env node
// #144 APP-036 — TestFlight release pipeline (SPEC-APP.md §9.10).
//
// Thin argv dispatcher run by scripts/testflight-release.sh via
// `node_modules/.bin/tsx scripts/testflight/cli.ts <subcommand> ...`. The
// three subcommands backed by lib.ts (check-env, export-options-plist,
// redact) are the gate-tested logic (see __tests__/lib.test.ts). verify-build
// and ensure-tester-group hit the live App Store Connect API and are
// exercised only by the real release run, never by the jest gate.
import { readFileSync, existsSync } from 'node:fs';
import {
  checkTestFlightEnv,
  buildExportOptionsPlist,
  redactSecrets,
  signAppStoreConnectJwt,
} from './lib';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function parseFlags(args: string[]): { flags: Record<string, string>; repeated: Record<string, string[]> } {
  const flags: Record<string, string> = {};
  const repeated: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
    flags[name] = value;
    (repeated[name] ??= []).push(value);
  }
  return { flags, repeated };
}

async function cmdCheckEnv(): Promise<number> {
  const result = checkTestFlightEnv(
    {
      ASC_KEY_ID: process.env.ASC_KEY_ID,
      ASC_ISSUER_ID: process.env.ASC_ISSUER_ID,
      ASC_KEY_PATH: process.env.ASC_KEY_PATH,
    },
    { fileExists: existsSync },
  );
  if (result.ok) {
    console.log('preflight ok: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH all set and key file present');
    return 0;
  }
  for (const name of result.missing) {
    console.error(`missing required env var: ${name}`);
  }
  for (const err of result.errors) {
    console.error(err);
  }
  return 1;
}

function cmdExportOptionsPlist(args: string[]): number {
  const { flags } = parseFlags(args);
  const plist = buildExportOptionsPlist({
    method: flags.method,
    destination: flags.destination,
    teamId: flags['team-id'],
    manageAppVersionAndBuildNumber: flags['no-manage-versions'] ? false : undefined,
  });
  process.stdout.write(plist);
  return 0;
}

async function cmdRedact(args: string[]): Promise<number> {
  const { repeated } = parseFlags(args);
  const input = await readStdin();
  process.stdout.write(redactSecrets(input, repeated.secret ?? []));
  return 0;
}

function loadAscJwt(): string {
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const keyPath = process.env.ASC_KEY_PATH;
  if (!keyId || !issuerId || !keyPath) {
    throw new Error('ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH must all be set');
  }
  const privateKeyPem = readFileSync(keyPath, 'utf8');
  return signAppStoreConnectJwt({ keyId, issuerId, privateKeyPem });
}

const ASC_API_BASE = 'https://api.appstoreconnect.apple.com/v1';

async function ascFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jwt = loadAscJwt();
  return fetch(`${ASC_API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  });
}

async function cmdVerifyBuild(args: string[]): Promise<number> {
  const { flags } = parseFlags(args);
  const bundleId = flags['bundle-id'] ?? process.env.BUNDLE_ID ?? 'io.fabcollections';

  const appsRes = await ascFetch(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  if (!appsRes.ok) {
    console.error(`ASC API /apps lookup failed: ${appsRes.status} ${appsRes.statusText}`);
    return 1;
  }
  const appsBody = (await appsRes.json()) as { data: Array<{ id: string; attributes: { name: string } }> };
  const app = appsBody.data[0];
  if (!app) {
    console.error(`no App Store Connect app found for bundle id ${bundleId}`);
    return 1;
  }
  console.log(`app: ${app.attributes.name} (${bundleId}), asc app id ${app.id}`);

  const buildsRes = await ascFetch(
    `/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5&fields[builds]=version,uploadedDate,processingState,expired`,
  );
  if (!buildsRes.ok) {
    console.error(`ASC API /builds lookup failed: ${buildsRes.status} ${buildsRes.statusText}`);
    return 1;
  }
  const buildsBody = (await buildsRes.json()) as {
    data: Array<{ id: string; attributes: { version: string; uploadedDate: string; processingState: string; expired: boolean } }>;
  };
  if (buildsBody.data.length === 0) {
    console.log('no builds visible yet for this app (processing can take several minutes after upload)');
    return 0;
  }
  for (const build of buildsBody.data) {
    console.log(
      `build ${build.attributes.version} — ${build.attributes.processingState} — uploaded ${build.attributes.uploadedDate}${build.attributes.expired ? ' (expired)' : ''} — id ${build.id}`,
    );
  }
  return 0;
}

async function cmdEnsureTesterGroup(args: string[]): Promise<number> {
  const { flags } = parseFlags(args);
  const bundleId = flags['bundle-id'] ?? process.env.BUNDLE_ID ?? 'io.fabcollections';
  const groupName = flags.name ?? 'Team';

  const appsRes = await ascFetch(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  if (!appsRes.ok) {
    console.error(`ASC API /apps lookup failed: ${appsRes.status} ${appsRes.statusText}`);
    return 1;
  }
  const appsBody = (await appsRes.json()) as { data: Array<{ id: string }> };
  const app = appsBody.data[0];
  if (!app) {
    console.error(`no App Store Connect app found for bundle id ${bundleId}`);
    return 1;
  }

  const groupsRes = await ascFetch(`/apps/${app.id}/betaGroups?fields[betaGroups]=name,isInternalGroup`);
  if (!groupsRes.ok) {
    console.error(`ASC API /betaGroups lookup failed: ${groupsRes.status} ${groupsRes.statusText}`);
    return 1;
  }
  const groupsBody = (await groupsRes.json()) as {
    data: Array<{ id: string; attributes: { name: string; isInternalGroup: boolean } }>;
  };
  const existing = groupsBody.data.find((g) => g.attributes.isInternalGroup);
  if (existing) {
    console.log(`internal testing group already exists: "${existing.attributes.name}" (id ${existing.id})`);
    return 0;
  }

  const createRes = await ascFetch('/betaGroups', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'betaGroups',
        attributes: { name: groupName, isInternalGroup: true, hasAccessToAllBuilds: true },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    console.error(`failed to create internal testing group: ${createRes.status} ${createRes.statusText}\n${body}`);
    return 1;
  }
  const created = (await createRes.json()) as { data: { id: string; attributes: { name: string } } };
  console.log(`created internal testing group: "${created.data.attributes.name}" (id ${created.data.id})`);
  return 0;
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);
  let code: number;
  switch (subcommand) {
    case 'check-env':
      code = await cmdCheckEnv();
      break;
    case 'export-options-plist':
      code = cmdExportOptionsPlist(rest);
      break;
    case 'redact':
      code = await cmdRedact(rest);
      break;
    case 'verify-build':
      code = await cmdVerifyBuild(rest);
      break;
    case 'ensure-tester-group':
      code = await cmdEnsureTesterGroup(rest);
      break;
    default:
      console.error(`unknown subcommand: ${subcommand ?? '(none)'}`);
      console.error('usage: cli.ts <check-env|export-options-plist|redact|verify-build|ensure-tester-group> [flags]');
      code = 1;
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
