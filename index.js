const ALLOWED_EVENTS = ['pull_request', 'pull_request_target'];
const DEFAULT_LABEL = 'safe to test';

async function run(modules = {}) {
    let core = modules.core;
    let github = modules.github;

    try {
        core = core || await import('@actions/core');
        github = github || await import('@actions/github');

        const context = github.context || {};
        if (!ALLOWED_EVENTS.includes(context.eventName)) {
            core.info(`Event "${context.eventName}", skipping. This action only supports: ${ALLOWED_EVENTS.join(', ')}.`);
            return;
        }

        const { payload, pullRequest } = getPayloadAndPr(context);
        const { headRepoFullName, baseRepoFullName } = getRepositoryNames(payload, pullRequest);

        if (headRepoFullName === baseRepoFullName) {
            core.info('Pull request is not from a fork, skipping.');
            return;
        }

        const safeToTestLabelName = normalizeLabel(core.getInput('label'));
        const shouldRequireReapproval = toBoolean(core.getInput('require-reapproval'));

        const hasLabel = checkLabel(pullRequest, safeToTestLabelName);

        if (!hasLabel) {
            core.setFailed(
                `Pull request does not have the "${safeToTestLabelName}" label. ` +
                `Code owners must add the "${safeToTestLabelName}" label to the pull request before the workflow can run.`
            );
            return;
        }

        core.info(`Pull request has the "${safeToTestLabelName}" label, changes are approved.`);

        if (shouldRequireReapproval) {
            const token = core.getInput('repo-token');
            try {
                await removeLabel({
                    context,
                    github,
                    token,
                    labelName: safeToTestLabelName,
                    pullRequest,
                    payload,
                });
                core.info(`Removed the "${safeToTestLabelName}" label from pull request. Every change must be re-approved. Next workflow run requires the "${safeToTestLabelName}" label again.`);
            } catch (error) {
                if (isLabelAlreadyGoneError(error)) {
                    pullRequest.labels = Array.isArray(pullRequest.labels)
                        ? pullRequest.labels.filter((label) => !(isObject(label) && label.name === safeToTestLabelName))
                        : pullRequest.labels;
                    core.info('Label was removed during action execution, continuing.');
                } else {
                    throw error;
                }
            }
        }
    } catch (error) {
        core.setFailed(getFailureMessage(error));
    }
}

function normalizeLabel(inputLabel) {
    if (typeof inputLabel !== 'string') {
        return DEFAULT_LABEL;
    }

    const trimmed = inputLabel.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_LABEL;
}

function toBoolean(inputValue) {
    if (typeof inputValue !== 'string') {
        return true;
    }

    return inputValue.trim().toLowerCase() === 'true';
}

function getPayloadAndPr(context) {
    const payload = context?.payload;
    const pullRequest = payload?.pull_request;

    if (!isObject(payload) || !isObject(pullRequest)) {
        throw new Error('Event payload does not include a pull_request object.');
    }

    return { payload, pullRequest };
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

function getRepositoryNames(payload, pullRequest) {
    const headRepoFullName = pullRequest?.head?.repo?.full_name;
    const baseRepoFullName = payload?.repository?.full_name || pullRequest?.base?.repo?.full_name;

    if (!headRepoFullName || !baseRepoFullName) {
        throw new Error('Unable to determine head/base repository names from the event payload.');
    }

    return { headRepoFullName, baseRepoFullName };
}

function checkLabel(pullRequest, labelName) {
    if (!Array.isArray(pullRequest.labels)) {
        return false;
    }

    return pullRequest.labels.some((label) => isObject(label) && label.name === labelName);
}

async function removeLabel({ context, github, token, labelName, pullRequest, payload }) {
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

    // Keep in-memory payload consistent so the verification step reflects the removal.
    pullRequest.labels = pullRequest.labels.filter((label) => !(isObject(label) && label.name === labelName));
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
