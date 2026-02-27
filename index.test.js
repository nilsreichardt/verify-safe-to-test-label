const run = require('./index');

describe('verify-safe-to-test-label', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('fails when pull request is from a fork and required label is missing', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([]));
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe-to-test' : '');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe-to-test" label. ' +
            'Code owners must add the "safe-to-test" label to the pull request before the workflow can run.'
        );
    });

    test('does not fail when pull request is from a fork and required label exists', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([{ name: 'safe-to-test' }]));
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe-to-test' : '');

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith('Pull request has the "safe-to-test" label, changes are approved.');
    });

    test('removes label when require-reapproval is enabled', async () => {
        const removeLabelMock = jest.fn().mockResolvedValue(undefined);
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        const github = createGithubMock('pull_request_target', payload, removeLabelMock);
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(github.getOctokit).toHaveBeenCalledWith('token-123');
        expect(removeLabelMock).toHaveBeenCalledWith({
            owner: 'base-owner',
            repo: 'repo',
            issue_number: 1,
            name: 'safe to test',
        });
        expect(core.info).toHaveBeenNthCalledWith(1, 'Pull request has the "safe to test" label, changes are approved.');
        expect(core.info).toHaveBeenNthCalledWith(2, 'Removed the "safe to test" label from pull request. Every change must be re-approved. Next workflow run requires the "safe to test" label again.');
        expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('removes label on labeled event when require-reapproval is enabled', async () => {
        const removeLabelMock = jest.fn().mockResolvedValue(undefined);
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'labeled' });
        const github = createGithubMock('pull_request_target', payload, removeLabelMock);
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(github.getOctokit).toHaveBeenCalledWith('token-123');
        expect(removeLabelMock).toHaveBeenCalledWith({
            owner: 'base-owner',
            repo: 'repo',
            issue_number: 1,
            name: 'safe to test',
        });
        expect(core.info).toHaveBeenNthCalledWith(1, 'Pull request has the "safe to test" label, changes are approved.');
        expect(core.info).toHaveBeenNthCalledWith(2, 'Removed the "safe to test" label from pull request. Every change must be re-approved. Next workflow run requires the "safe to test" label again.');
        expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('continues when label was already removed by race condition', async () => {
        const notFoundError = new Error('Label does not exist');
        notFoundError.status = 404;
        const removeLabelMock = jest.fn().mockRejectedValue(notFoundError);
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        const github = createGithubMock('pull_request', payload, removeLabelMock);
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(core.info).toHaveBeenNthCalledWith(1, 'Pull request has the "safe to test" label, changes are approved.');
        expect(core.info).toHaveBeenNthCalledWith(2, 'Label was removed during action execution, continuing.');
        expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('uses helpful error message when workflow token permissions are missing', async () => {
        const permissionError = new Error('Resource not accessible by integration');
        permissionError.status = 403;
        const removeLabelMock = jest.fn().mockRejectedValue(permissionError);
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        const github = createGithubMock('pull_request_target', payload, removeLabelMock);
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Failed to remove label because the workflow token lacks required permissions. Ensure your workflow grants `contents: read` and `pull-requests: write`.'
        );
    });

    test('fails with clear message when pull request number is missing for label removal', async () => {
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        delete payload.pull_request.number;
        const github = createGithubMock('pull_request_target', payload);
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith('Unable to determine pull request number from the event payload.');
    });

    test('falls back to payload repository full name when context repo is unavailable', async () => {
        const removeLabelMock = jest.fn().mockResolvedValue(undefined);
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        payload.repository.full_name = 'fallback-owner/fallback-repo';
        const github = createGithubMock('pull_request_target', payload, removeLabelMock, { repo: undefined });
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(removeLabelMock).toHaveBeenCalledWith({
            owner: 'fallback-owner',
            repo: 'fallback-repo',
            issue_number: 1,
            name: 'safe to test',
        });
    });

    test('fails when payload repository full name cannot be parsed in fallback', async () => {
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        payload.repository.full_name = 'not-a-full-name';
        const github = createGithubMock('pull_request_target', payload, undefined, { repo: undefined });
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Unable to determine base repository owner/name from the event payload.'
        );
    });

    test('fails when payload repository full name contains empty owner and repo in fallback', async () => {
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        payload.repository.full_name = '/';
        const github = createGithubMock('pull_request_target', payload, undefined, { repo: undefined });
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Unable to determine base repository owner/name from the event payload.'
        );
    });

    test('normalizes an empty configured label to default', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([]));
        core.getInput.mockImplementation((name) => name === 'label' ? '   ' : '');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before the workflow can run.'
        );
    });

    test('uses default label and enables reapproval for non-string inputs', async () => {
        const core = createCoreMock();
        const removeLabelMock = jest.fn().mockResolvedValue(undefined);
        const github = createGithubMock(
            'pull_request_target',
            createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' }),
            removeLabelMock
        );
        core.getInput.mockReturnValue(undefined);

        await run({ core, github });

        expect(github.getOctokit).toHaveBeenCalled();
        expect(removeLabelMock).toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith('Pull request has the "safe to test" label, changes are approved.');
        expect(core.setFailed).not.toHaveBeenCalled();
    });

    test('treats non-array labels as missing', async () => {
        const core = createCoreMock();
        const payload = createForkPayload([]);
        payload.pull_request.labels = null;
        const github = createGithubMock('pull_request', payload);
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe to test' : '');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before the workflow can run.'
        );
    });

    test('does not fail when pull request is not from a fork', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createSameRepoPayload([]));
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe to test' : '');

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith('Pull request is not from a fork. Assuming the code is safe.');
    });

    test('skips unsupported events', async () => {
        const core = createCoreMock();
        const github = createGithubMock('push', createForkPayload([]));
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe to test' : '');

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith(
            'Event "push", skipping. This action only supports: pull_request, pull_request_target.'
        );
    });

    test('fails with clear message when payload is missing pull_request', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', { repository: { full_name: 'base-owner/repo' } });
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe to test' : '');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith('Event payload does not include a pull_request object.');
    });

    test('fails with clear message when repository names are unavailable', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', {
            pull_request: {
                head: { repo: {} },
                base: { repo: {} },
                labels: [],
            },
            repository: {},
        });
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe to test' : '');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Unable to determine head/base repository names from the event payload.'
        );
    });

    test('loads action modules when dependencies are not injected', async () => {
        await expect(run()).rejects.toThrow(/A dynamic import callback was invoked without --experimental-vm-modules/);
    });

    test('uses empty context when github context is missing', async () => {
        const core = createCoreMock();

        await run({ core, github: {} });

        expect(core.info).toHaveBeenCalledWith(
            'Event "undefined", skipping. This action only supports: pull_request, pull_request_target.'
        );
    });

    test('keeps labels unchanged when race-condition removal happens and labels are no longer an array', async () => {
        const notFoundError = new Error('Label does not exist');
        notFoundError.status = 404;
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        const removeLabelMock = jest.fn().mockImplementation(async () => {
            payload.pull_request.labels = null;
            throw notFoundError;
        });
        const core = createCoreMock();
        const github = createGithubMock('pull_request', payload, removeLabelMock);
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(core.info).toHaveBeenNthCalledWith(1, 'Pull request has the "safe to test" label, changes are approved.');
        expect(core.info).toHaveBeenNthCalledWith(2, 'Label was removed during action execution, continuing.');
        expect(payload.pull_request.labels).toBeNull();
    });

    test('coerces non-Error failures to strings', async () => {
        const removeLabelMock = jest.fn().mockRejectedValue('boom');
        const core = createCoreMock();
        const payload = createForkPayload([{ name: 'safe to test' }], { action: 'synchronize' });
        const github = createGithubMock('pull_request_target', payload, removeLabelMock);
        core.getInput.mockImplementation((name) => {
            if (name === 'label') return 'safe to test';
            if (name === 'require-reapproval') return 'true';
            if (name === 'repo-token') return 'token-123';
            return '';
        });

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith('boom');
    });
});

function createCoreMock() {
    return {
        getInput: jest.fn(),
        setFailed: jest.fn(),
        info: jest.fn(),
    };
}

function createGithubMock(eventName, payload, removeLabelMock = jest.fn().mockResolvedValue(undefined), contextOverrides = {}) {
    return {
        context: {
            eventName,
            payload,
            repo: { owner: 'base-owner', repo: 'repo' },
            ...contextOverrides,
        },
        getOctokit: jest.fn(() => ({
            rest: {
                issues: {
                    removeLabel: removeLabelMock,
                },
            },
        })),
    };
}

function createForkPayload(labels = [], { action = 'opened' } = {}) {
    return {
        action,
        pull_request: {
            number: 1,
            head: {
                repo: {
                    full_name: 'fork-owner/repo',
                },
            },
            base: {
                repo: {
                    full_name: 'base-owner/repo',
                },
            },
            labels,
        },
        repository: {
            full_name: 'base-owner/repo',
        },
    };
}

function createSameRepoPayload(labels = []) {
    return {
        action: 'opened',
        pull_request: {
            head: {
                repo: {
                    full_name: 'base-owner/repo',
                },
            },
            base: {
                repo: {
                    full_name: 'base-owner/repo',
                },
            },
            labels,
        },
        repository: {
            full_name: 'base-owner/repo',
        },
    };
}
