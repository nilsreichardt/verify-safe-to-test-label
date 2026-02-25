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
        if (hasLabel(pullRequest, safeToTestLabelName)) {
            core.info(`Pull request has the "${safeToTestLabelName}" label, skipping.`);
            return;
        }

        core.setFailed(
            `Pull request does not have the "${safeToTestLabelName}" label. ` +
            `Code owners must add the "${safeToTestLabelName}" label to the pull request before it can be tested.`
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        core.setFailed(message);
    }
}

function normalizeLabel(inputLabel) {
    if (typeof inputLabel !== 'string') {
        return DEFAULT_LABEL;
    }

    const trimmed = inputLabel.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_LABEL;
}

function getPayloadAndPr(context) {
    const payload = context?.payload;
    const pullRequest = payload?.pull_request;

    if (!isObject(payload) || !isObject(pullRequest)) {
        throw new Error('Event payload does not include a pull_request object.');
    }

    return { payload, pullRequest };
}

function getRepositoryNames(payload, pullRequest) {
    const headRepoFullName = pullRequest?.head?.repo?.full_name;
    const baseRepoFullName = payload?.repository?.full_name || pullRequest?.base?.repo?.full_name;

    if (!headRepoFullName || !baseRepoFullName) {
        throw new Error('Unable to determine head/base repository names from the event payload.');
    }

    return { headRepoFullName, baseRepoFullName };
}

function hasLabel(pullRequest, labelName) {
    if (!Array.isArray(pullRequest.labels)) {
        return false;
    }

    return pullRequest.labels.some((label) => isObject(label) && label.name === labelName);
}

function isObject(value) {
    return value !== null && typeof value === 'object';
}

// Export is only used for testing
module.exports = run;

if (require.main === module) {
    run();
}
