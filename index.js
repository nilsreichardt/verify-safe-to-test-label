const CONFIG = {
    allowedEvents: ['pull_request', 'pull_request_target'],
    defaultLabel: 'safe to test',
};

async function run(modules = {}) {
    const { core, github } = await resolveModules(modules);

    try {
        const context = resolveContext(core, github);
        if (!context) return;

        if (!isForkPullRequest(context)) {
            core.info('Pull request is not from a fork. Assuming the code is safe.');
            return;
        }

        const { labelName, isLabelPresent } = failIfLabelIsNotPresent(core, context);
        if (!isLabelPresent) return;

        core.info(`Pull request has the "${labelName}" label, changes are approved.`);
        await removeLabelWhenRequired(core, github, context, labelName);
    } catch (error) {
        core.setFailed(getFailureMessage(error));
    }
}

async function resolveModules(modules) {
    const core = modules.core || await import('@actions/core');
    const github = modules.github || await import('@actions/github');
    return { core, github };
}

function resolveContext(core, github) {
    const context = github.context || {};
    if (!CONFIG.allowedEvents.includes(context.eventName)) {
        core.info(`Event "${context.eventName}", skipping. This action only supports: ${CONFIG.allowedEvents.join(', ')}.`);
        return null;
    }


    const payload = context.payload;
    if (!isObject(payload) || !isObject(payload.pull_request)) {
        throw new Error('Event payload does not include a pull_request object.');
    }

    return context;
}

function isForkPullRequest(context) {
    const { headRepoFullName, baseRepoFullName } = getRepositoryNames(context);
    return headRepoFullName !== baseRepoFullName;
}

function failIfLabelIsNotPresent(core, context) {
    const labelName = normalizeLabel(core.getInput('label'));
    const isLabelPresent = checkLabel(context, labelName);
    if (!isLabelPresent) {
        core.setFailed(
            `Pull request does not have the "${labelName}" label. ` +
            `Code owners must add the "${labelName}" label to the pull request before the workflow can run.`
        );
        return { labelName: undefined, isLabelPresent: false };
    }
    return { labelName, isLabelPresent: true };
}

async function removeLabelWhenRequired(core, github, context, labelName) {
    const requiresReapproval = toBoolean(core.getInput('require-reapproval'));
    if (requiresReapproval) {
        const token = core.getInput('repo-token');
        try {
            await removeLabel({
                context,
                github,
                token,
                labelName,
            });
            core.info(`Removed the "${labelName}" label from pull request. Every change must be re-approved. Next workflow run requires the "${labelName}" label again.`);
        } catch (error) {
            if (isLabelAlreadyGoneError(error)) {
                core.info('Label was removed during action execution, continuing.');
            } else {
                throw error;
            }
        }
    }
}

function normalizeLabel(inputLabel) {
    if (typeof inputLabel !== 'string') {
        return CONFIG.defaultLabel;
    }

    const trimmed = inputLabel.trim();
    return trimmed.length > 0 ? trimmed : CONFIG.defaultLabel;
}

function toBoolean(inputValue, defaultValue = true) {
    if (typeof inputValue !== 'string') return defaultValue;
    return inputValue.trim().toLowerCase() === 'true';
}

function isLabelAlreadyGoneError(error) {
    return error?.message === 'Label does not exist' || error?.status === 404;
}

function isMissingIntegrationPermissionError(error) {
    return error?.status === 403
        && typeof error?.message === 'string'
        && error.message.includes('Resource not accessible by integration');
}

function getFailureMessage(error) {
    if (isMissingIntegrationPermissionError(error)) {
        return 'Failed to remove label because the workflow token lacks required permissions. Ensure your workflow grants `contents: read` and `pull-requests: write`.';
    }

    return error instanceof Error ? error.message : String(error);
}

function getRepositoryNames(context) {
    const payload = context.payload;
    const pullRequest = payload.pull_request;
    const headRepoFullName = pullRequest?.head?.repo?.full_name;
    const baseRepoFullName = payload?.repository?.full_name ?? pullRequest?.base?.repo?.full_name;

    if (!headRepoFullName || !baseRepoFullName) {
        throw new Error('Unable to determine head/base repository names from the event payload.');
    }

    return { headRepoFullName, baseRepoFullName };
}

function checkLabel(context, labelName) {
    const pullRequest = context.payload.pull_request;

    if (!Array.isArray(pullRequest.labels)) {
        return false;
    }

    return pullRequest.labels.some((label) => isObject(label) && label.name === labelName);
}

async function removeLabel({ context, github, token, labelName }) {
    const { payload } = context;
    const pullRequest = payload.pull_request;
    const octokit = github.getOctokit(token);
    const { owner, repo } = getOwnerAndRepo(context, payload);
    const issueNumber = pullRequest?.number;

    if (!issueNumber) {
        throw new Error('Unable to determine pull request number from the event payload.');
    }

    await octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelName,
    });
}

function getOwnerAndRepo(context, payload) {
    if (context?.repo?.owner && context?.repo?.repo) {
        return { owner: context.repo.owner, repo: context.repo.repo };
    }

    const fullName = payload?.repository?.full_name;
    if (typeof fullName !== 'string' || !fullName.includes('/')) {
        throw new Error('Unable to determine base repository owner/name from the event payload.');
    }

    const [owner, repo] = fullName.split('/', 2);
    if (!owner || !repo) {
        throw new Error('Unable to determine base repository owner/name from the event payload.');
    }

    return { owner, repo };
}

function isObject(value) {
    return value !== null && typeof value === 'object';
}

// Export is only used for testing
module.exports = run;

/* istanbul ignore next -- direct CLI invocation is not exercised in Jest */
if (require.main === module) {
    run();
}
