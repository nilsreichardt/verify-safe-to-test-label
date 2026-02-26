const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENTRYPOINT = path.join(ROOT, 'index.js');

const scenarios = [
  {
    name: 'fork PR without label fails',
    eventName: 'pull_request',
    fixtureFile: 'fork-missing-label.json',
    expectedExitCode: 1,
    expectedOutputParts: [
      'Pull request does not have the "safe to test" label.',
    ],
  },
  {
    name: 'fork PR with custom label passes',
    eventName: 'pull_request',
    fixtureFile: 'fork-with-custom-label.json',
    inputLabel: 'safe-to-test',
    expectedExitCode: 0,
    expectedOutputParts: [
      'Pull request has the "safe-to-test" label, skipping.',
    ],
  },
  {
    name: 'same repository PR skips',
    eventName: 'pull_request',
    fixtureFile: 'same-repo.json',
    expectedExitCode: 0,
    expectedOutputParts: [
      'Pull request is not from a fork, skipping.',
    ],
  },
  {
    name: 'unsupported event skips',
    eventName: 'push',
    fixtureFile: 'fork-missing-label.json',
    expectedExitCode: 0,
    expectedOutputParts: [
      'Event "push", skipping. This action only supports: pull_request, pull_request_target.',
    ],
  },
  {
    name: 'invalid payload fails with clear error',
    eventName: 'pull_request_target',
    fixtureFile: 'invalid-payload.json',
    expectedExitCode: 1,
    expectedOutputParts: [
      'Event payload does not include a pull_request object.',
    ],
  },
];

let failed = 0;

for (const scenario of scenarios) {
  const fixturePath = path.join(__dirname, 'fixtures', scenario.fixtureFile);
  const payload = fs.readFileSync(fixturePath, 'utf8');
  const { eventPath, tempDir } = writeEventPayload(payload);

  try {
    const child = spawnSync(process.execPath, [ENTRYPOINT], {
      cwd: ROOT,
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: scenario.eventName,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'base-owner/repo',
        INPUT_LABEL: scenario.inputLabel || '',
      },
      encoding: 'utf8',
    });

    const output = `${child.stdout || ''}\n${child.stderr || ''}`;
    const exitCode = child.status == null ? 1 : child.status;

    const codeMatches = exitCode === scenario.expectedExitCode;
    const outputMatches = scenario.expectedOutputParts.every((part) => output.includes(part));

    if (codeMatches && outputMatches) {
      console.log(`PASS: ${scenario.name}`);
    } else {
      failed += 1;
      console.error(`FAIL: ${scenario.name}`);
      console.error(`Expected exit code: ${scenario.expectedExitCode}, actual: ${exitCode}`);
      console.error('Expected output to include:');
      for (const part of scenario.expectedOutputParts) {
        console.error(`  - ${part}`);
      }
      console.error('Actual combined output:');
      console.error(output.trim());
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (failed > 0) {
  console.error(`\n${failed} e2e scenario(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${scenarios.length} e2e scenarios passed.`);

function writeEventPayload(payload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-safe-to-test-label-'));
  const filePath = path.join(tempDir, 'event.json');
  fs.writeFileSync(filePath, payload, 'utf8');
  return { eventPath: filePath, tempDir };
}
