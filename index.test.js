const run = require('./index');

describe('verify-safe-to-test-label', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('fails when pull request is from a fork and required label is missing', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([]));
        core.getInput.mockReturnValue('safe-to-test');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe-to-test" label. ' +
            'Code owners must add the "safe-to-test" label to the pull request before it can be tested.'
        );
    });

    test('does not fail when pull request is from a fork and required label exists', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([{ name: 'safe-to-test' }]));
        core.getInput.mockReturnValue('safe-to-test');

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith('Pull request has the "safe-to-test" label, skipping.');
    });

    test('uses configured label in failure message', async () => {
        const customLabelName = 'ready-for-ci';
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([]));
        core.getInput.mockReturnValue(customLabelName);

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            `Pull request does not have the "${customLabelName}" label. ` +
            `Code owners must add the "${customLabelName}" label to the pull request before it can be tested.`
        );
    });

    test('normalizes an empty configured label to default', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([]));
        core.getInput.mockReturnValue('   ');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before it can be tested.'
        );
    });

    test('normalizes a non-string configured label to default', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createForkPayload([]));
        core.getInput.mockReturnValue(undefined);

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before it can be tested.'
        );
    });

    test('does not fail when pull request is not from a fork', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', createSameRepoPayload([]));
        core.getInput.mockReturnValue('safe to test');

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith('Pull request is not from a fork, skipping.');
    });

    test('skips unsupported events', async () => {
        const core = createCoreMock();
        const github = createGithubMock('push', createForkPayload([]));
        core.getInput.mockReturnValue('safe to test');

        await run({ core, github });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith(
            'Event "push", skipping. This action only supports: pull_request, pull_request_target.'
        );
    });

    test('fails with clear message when payload is missing pull_request', async () => {
        const core = createCoreMock();
        const github = createGithubMock('pull_request', { repository: { full_name: 'base-owner/repo' } });
        core.getInput.mockReturnValue('safe to test');

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
        core.getInput.mockReturnValue('safe to test');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Unable to determine head/base repository names from the event payload.'
        );
    });

    test('treats non-array labels as missing labels', async () => {
        const core = createCoreMock();
        const payload = createForkPayload([]);
        const github = createGithubMock('pull_request', {
            ...payload,
            pull_request: {
                ...payload.pull_request,
                labels: null,
            },
        });
        core.getInput.mockReturnValue('safe to test');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            'Pull request does not have the "safe to test" label. ' +
            'Code owners must add the "safe to test" label to the pull request before it can be tested.'
        );
    });
});

function createCoreMock() {
    return {
        getInput: jest.fn(),
        setFailed: jest.fn(),
        info: jest.fn(),
    };
}

function createGithubMock(eventName, payload) {
    return {
        context: { eventName, payload },
        getOctokit: jest.fn(),
    };
}

function createForkPayload(labels = []) {
    return {
        pull_request: {
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