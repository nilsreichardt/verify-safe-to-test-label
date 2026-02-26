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
            'Code owners must add the "safe-to-test" label to the pull request before it can be tested.'
        );
    });

    test('does not fail when pull request is from a fork and required label exists', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([{ name: 'safe-to-test' }]));
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe-to-test' : '');

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith('Pull request has the "safe-to-test" label, skipping.');
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
        expect(core.info).toHaveBeenCalledWith('Removed the "safe to test" label from pull request. Every change must be re-approved.');
        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before it can be tested.'
        );
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
        expect(core.info).toHaveBeenCalledWith('Removed the "safe to test" label from pull request. Every change must be re-approved.');
        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before it can be tested.'
        );
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

        expect(core.info).toHaveBeenCalledWith('Label was removed during action execution, continuing.');
        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before it can be tested.'
        );
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

    test('normalizes an empty configured label to default', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([]));
        core.getInput.mockImplementation((name) => name === 'label' ? '   ' : '');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before it can be tested.'
        );
    });

    test('does not fail when pull request is not from a fork', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createSameRepoPayload([]));
        core.getInput.mockImplementation((name) => name === 'label' ? 'safe to test' : '');

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith('Pull request is not from a fork, skipping.');
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
        await expect(run()).rejects.toThrow(/Cannot read properties of undefined/);
    });
});

function createCoreMock() {
    return {
        getInput: jest.fn(),
        setFailed: jest.fn(),
        info: jest.fn(),
    };
}

function createGithubMock(eventName, payload, removeLabelMock = jest.fn().mockResolvedValue(undefined)) {
    return {
        context: {
            eventName,
            payload,
            repo: { owner: 'base-owner', repo: 'repo' },
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
