const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const CONTEXT_MODULE_PATH = pathToFileURL(
  path.join(ROOT, 'node_modules', '@actions', 'github', 'lib', 'context.js'),
).href;

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
    name: 'same repository PR skips',
    eventName: 'pull_request',
    fixtureFile: 'same-repo.json',
    expectedExitCode: 0,
    expectedOutputParts: [
      'Pull request is not from a fork. Assuming the code is safe.',
    ],
  },
  {
    name: 'synchronize removes default label via API then allows current run and requires reapproval next run',
    eventName: 'pull_request_target',
    fixtureFile: 'fork-with-default-label.json',
    inputRequireReapproval: 'true',
    expectedExitCode: 0,
    expectedOutputParts: [
      'Pull request has the "safe to test" label, changes are approved.',
      'Removed the "safe to test" label from pull request. Every change must be re-approved.',
    ],
    expectedApiCall: {
      method: 'DELETE',
      path: '/repos/base-owner/repo/issues/42/labels/safe%20to%20test',
      authorization: 'token test-token',
      statusCode: 204,
    },
  },
];

let failed = 0;

(async () => {
  const mockApi = await startMockApi();

  process.env.GITHUB_API_URL = mockApi.baseUrl;

  const run = require(path.join(ROOT, 'index.js'));
  const core = await import('@actions/core');
  const github = await import('@actions/github');
  const { Context } = await import(CONTEXT_MODULE_PATH);

  for (const scenario of scenarios) {
    const fixturePath = path.join(__dirname, 'fixtures', scenario.fixtureFile);
    const payload = fs.readFileSync(fixturePath, 'utf8');
    const { eventPath, tempDir } = writeEventPayload(payload);

    const restoreEnv = withScenarioEnv({
      eventName: scenario.eventName,
      eventPath,
      inputLabel: scenario.inputLabel || 'safe to test',
      inputRequireReapproval: scenario.inputRequireReapproval || 'false',
    });

    process.exitCode = 0;
    mockApi.expectedApiCall = scenario.expectedApiCall || null;
    mockApi.calls.length = 0;

    try {
      const githubRuntime = {
        getOctokit: github.getOctokit,
        context: new Context(),
      };

      const output = await captureOutput(async () => {
        await run({ core, github: githubRuntime });
      });

      const exitCode = process.exitCode || 0;
      const codeMatches = exitCode === scenario.expectedExitCode;
      const outputMatches = outputIncludesPartsInOrder(output, scenario.expectedOutputParts);
      const apiMatches = validateApiExpectation(scenario, mockApi.calls);

      if (codeMatches && outputMatches && apiMatches.ok) {
        console.log(`PASS: ${scenario.name}`);
        continue;
      }

      failed += 1;
      console.error(`FAIL: ${scenario.name}`);
      if (!codeMatches) {
        console.error(`Expected exit code: ${scenario.expectedExitCode}, actual: ${exitCode}`);
      }
      if (!outputMatches) {
        console.error('Expected output to include:');
        for (const part of scenario.expectedOutputParts) {
          console.error(`  - ${part}`);
        }
        console.error('Actual combined output:');
        console.error(output.trim());
      }
      if (!apiMatches.ok) {
        console.error(`API assertion failed: ${apiMatches.message}`);
        console.error(`Observed API calls: ${JSON.stringify(mockApi.calls, null, 2)}`);
      }
    } finally {
      process.exitCode = 0;
      restoreEnv();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  await mockApi.stop();

  if (failed > 0) {
    console.error(`\n${failed} e2e scenario(s) failed.`);
    process.exit(1);
  }

  console.log(`\nAll ${scenarios.length} e2e scenarios passed.`);
})();

function withScenarioEnv({ eventName, eventPath, inputLabel, inputRequireReapproval }) {
  const envsToSet = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: eventName,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'base-owner/repo',
    INPUT_LABEL: inputLabel,
    'INPUT_REQUIRE-REAPPROVAL': inputRequireReapproval,
    'INPUT_REPO-TOKEN': 'test-token',
  };

  const previousEnvs = {};
  for (const name in envsToSet) {
    previousEnvs[name] = process.env[name];
    process.env[name] = envsToSet[name];
  }

  return () => {
    for (const name in previousEnvs) {
      restoreEnvVar(name, previousEnvs[name]);
    }
  };
}

function restoreEnvVar(name, value) {
  if (value == null) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function captureOutput(runScenario) {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  let output = '';

  process.stdout.write = (chunk, encoding, callback) => {
    output += normalizeChunk(chunk, encoding);
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };

  process.stderr.write = (chunk, encoding, callback) => {
    output += normalizeChunk(chunk, encoding);
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };

  return Promise.resolve()
    .then(runScenario)
    .then(() => output)
    .finally(() => {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    });
}

function normalizeChunk(chunk, encoding) {
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString(encoding || 'utf8');
  }

  return String(chunk);
}

function outputIncludesPartsInOrder(output, expectedParts) {
  let index = 0;
  for (const part of expectedParts) {
    const nextIndex = output.indexOf(part, index);
    if (nextIndex === -1) {
      return false;
    }
    index = nextIndex + part.length;
  }

  return true;
}

function validateApiExpectation(scenario, calls) {
  if (!scenario.expectedApiCall) {
    if (calls.length > 0) {
      return {
        ok: false,
        message: 'expected no API calls but at least one call was observed',
      };
    }

    return { ok: true };
  }

  if (calls.length !== 1) {
    return {
      ok: false,
      message: `expected exactly one API call but got ${calls.length}`,
    };
  }

  const call = calls[0];
  if (call.method !== scenario.expectedApiCall.method) {
    return {
      ok: false,
      message: `expected method ${scenario.expectedApiCall.method}, got ${call.method}`,
    };
  }

  if (call.path !== scenario.expectedApiCall.path) {
    return {
      ok: false,
      message: `expected path ${scenario.expectedApiCall.path}, got ${call.path}`,
    };
  }

  if (call.authorization !== scenario.expectedApiCall.authorization) {
    return {
      ok: false,
      message: `expected authorization ${scenario.expectedApiCall.authorization}, got ${call.authorization}`,
    };
  }

  return { ok: true };
}

function writeEventPayload(payload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-safe-to-test-label-'));
  const eventPath = path.join(tempDir, 'event.json');
  fs.writeFileSync(eventPath, payload, 'utf8');
  return { eventPath, tempDir };
}

function startMockApi() {
  const calls = [];
  const state = {
    expectedApiCall: null,
    calls,
  };

  const server = http.createServer((req, res) => {
    const call = {
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization || '',
    };
    calls.push(call);

    const expectedApiCall = state.expectedApiCall;
    if (!expectedApiCall) {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: 'Unexpected API call.' }));
      return;
    }

    if (req.method !== expectedApiCall.method || req.url !== expectedApiCall.path) {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: 'Unexpected API request path or method.' }));
      return;
    }

    res.statusCode = expectedApiCall.statusCode;
    res.setHeader('content-type', 'application/json');
    if (expectedApiCall.responseBody) {
      res.end(JSON.stringify(expectedApiCall.responseBody));
      return;
    }

    res.end(JSON.stringify({}));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;
      resolve({
        baseUrl,
        calls,
        get expectedApiCall() {
          return state.expectedApiCall;
        },
        set expectedApiCall(value) {
          state.expectedApiCall = value;
        },
        stop() {
          return new Promise((stopResolve) => {
            server.close(() => stopResolve());
          });
        },
      });
    });
  });
}
