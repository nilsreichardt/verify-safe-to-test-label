async function run(modules = {}) {
    let core = modules.core;
    let github = modules.github;

    try {
        core = core || await import('@actions/core');
        github = github || await import('@actions/github');

        const context = github.context;

        const allowedEvents = ['pull_request', 'pull_request_target'];
        const isNotAllowedEvent = allowedEvents.indexOf(context.eventName) === -1;
        if (isNotAllowedEvent) {
            console.log(`Event "${context.eventName}", skipping. This action only works with the following events: ${allowedEvents.join(', ')}.`);
            return;
        }

        const headRepoFullName = context.payload.pull_request.head.repo.full_name;
        const baseRepoFullName = context.payload.repository.full_name;

        const isFork = headRepoFullName !== baseRepoFullName;
        if (!isFork) {
            console.log(`Pull request is not from a fork, skipping.`);
            return;
        }

        const safeToTestLabelName = core.getInput('label');

        // Check if pull request has the configured safe-to-test label
        const labels = context.payload.pull_request.labels;
        const hasSafeToTestLabel = labels.find(label => label.name === safeToTestLabelName);
        if (hasSafeToTestLabel) {
            console.log(`Pull request have the "${safeToTestLabelName}" label, skipping.`);
            return;
        }

        core.setFailed(`Pull request does not have the "${safeToTestLabelName}" label. Code owners must add the "${safeToTestLabelName}" label to the pull request before it can be tested.`);
    } catch (error) {
        core.setFailed(error.message);
    }
}

// Export is only used for testing
module.exports = run;

if (require.main === module) {
    run();
}
