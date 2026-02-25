const run = require('./index');

describe('verify-safe-to-test-label', () => {
    const core = {
        getInput: jest.fn(),
        setFailed: jest.fn(),
    };
    const github = {
        context: {},
        getOctokit: jest.fn(),
    };

    afterEach(() => {
        jest.clearAllMocks();
        github.context = {};
    });

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    afterAll(() => {
        consoleLogSpy.mockRestore();
    });

    test('should fail when pull request is from a fork and "safe-to-test" label is not assigned', async () => {
        const payload = {
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
                labels: [],
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;

        core.getInput.mockReturnValue('safe-to-test');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            `Pull request does not have the "safe-to-test" label. Code owners must add the "safe-to-test" label to the pull request before it can be tested.`
        );
    });

    test('should not fail when pull request is from a fork and "safe-to-test" label is assigned', async () => {
        const payload = {
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
                labels: [
                    {
                        name: 'safe-to-test',
                    },
                ],
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;

        core.getInput.mockReturnValue('safe-to-test');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledTimes(0);
    });

    test('should use configured label in failure message', async () => {
        const customLabelName = 'ready-for-ci';
        const payload = {
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
                labels: [],
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;

        core.getInput.mockReturnValue(customLabelName);

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith(
            `Pull request does not have the "${customLabelName}" label. Code owners must add the "${customLabelName}" label to the pull request before it can be tested.`
        );
    });

    test('should use configured label in skip log message', async () => {
        const customLabelName = 'ready-for-ci';
        const payload = {
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
                labels: [
                    {
                        name: customLabelName,
                    },
                ],
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;

        core.getInput.mockReturnValue(customLabelName);

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `Pull request have the "${customLabelName}" label, skipping.`
        );
    });

    test('should not fail when pull request is not from a fork', async () => {
        const payload = {
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
                labels: [],
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'pull_request';
        github.context.payload = payload;

        core.getInput.mockReturnValue('safe-to-test');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledTimes(0);
    });

    test('should skip when eventName is not allowed', async () => {
        const payload = {
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
                labels: [],
            },
            repository: {
                full_name: 'base-owner/repo',
            },
        };

        github.context.eventName = 'not_allowed_event';
        github.context.payload = payload;

        core.getInput.mockReturnValue('safe-to-test');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(github.getOctokit).toHaveBeenCalledTimes(0);
    });

    test('should fail when there is an error', async () => {
        github.context.eventName = 'pull_request';
        github.context.payload = null;

        core.getInput.mockReturnValue('safe-to-test');

        await run({ core, github });

        expect(core.setFailed).toHaveBeenCalledWith("Cannot read properties of null (reading 'pull_request')");
    });
});
