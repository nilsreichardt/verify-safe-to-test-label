# verify-safe-to-test-label

<a href="https://codecov.io/gh/nilsreichardt/verify-safe-to-test-label"><img src="https://codecov.io/gh/nilsreichardt/verify-safe-to-test-label/branch/main/graph/badge.svg" alt="codecov"></a>

A GitHub Action that verifies if the `safe to test` label is assigned to a Pull Request before running sensitive steps, and can optionally remove it on new commits.

If you are using `pull_request_target` in your workflows, there is a high probability your repository is vulnerable to secret exfiltration. This action acts as a manual "Gatekeeper" to protect your infrastructure.

## Quick Start

1.  Add the `labeled` type to your `pull_request_target` trigger.
2.  Add `nilsreichardt/verify-safe-to-test-label@v2` to the start of your job.

```yaml
on:
  pull_request_target:
    types:
      - opened
      - synchronize
      - reopened
      # Used to trigger the action when the "safe to test" label is added to the PR
      - labeled

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    permissions:
      # Required when require-reapproval=true
      pull-requests: write
    steps:
      # 1. Check the gate (and reset it on every workflow run when require-reapproval=true)
      - name: Ensure PR has "safe to test" label, if PR is from a fork
        uses: nilsreichardt/verify-safe-to-test-label@v2
        with:
          label: "safe to test" # optional, default is "safe to test"
          require-reapproval: true # optional, default is true.

      # 2. Securely run your tests
      - name: Checkout PR code
        uses: actions/checkout@v6
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          repository: ${{ github.event.pull_request.head.repo.full_name }}

      - name: Test with Secrets
        run: npm install && npm test
        env:
          STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}
```

### Workflow with multiple jobs

If you have multiple jobs in your workflow, you can have a job that verifies the label and other jobs require this job to pass.

```yaml
# [...]

jobs:
  verify-safe-to-test-label:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - name: Ensure PR has "safe to test" label, if PR is from a fork
        uses: nilsreichardt/verify-safe-to-test-label@v2

  macos-tests:
    needs: verify-safe-to-test-label # This job will only run if the verify-safe-to-test-label job passes
    runs-on: macos-latest
    steps:
      # [... steps for macos tests]
  
  linux-tests:
    needs: verify-safe-to-test-label # This job will only run if the verify-safe-to-test-label job passes
    runs-on: linux-latest
    steps:
      # [... steps for linux tests]
```

## Inputs

| Name    | Description                                      | Default        |
| ------- | ------------------------------------------------ | -------------- |
| `label` | The name of the label required to pass the check. Always passes if the pull request is not from a fork. | `safe to test` |
| `require-reapproval` | Remove the label on every workflow run to force re-review of new commits. When you set this to `false`, an attacker could push malicious code _after_ you marked the code as safe with the label. | `true` |
| `repo-token` | Token used to remove labels when `require-reapproval=true`. Requires `pull-requests: write` | `github.token` |

## Motivation: The "Pwn Request"

### The Problem

When you use `pull_request_target`, GitHub grants the runner access to your repository's **Secrets** and a **Read/Write GITHUB_TOKEN**. If your workflow checks out code from the PR author's fork and runs it, you have a critical vulnerability.

> [!CAUTION]
> **Is your CI/CD pipeline insecure?**
> You are at risk if all three are true:
>
> 1.  You use the `pull_request_target` trigger.
> 2.  You check out code from the **head** (the fork).
> 3.  You execute scripts from that code (e.g., `npm install`, `npm test`, `make`, `python setup.py`).

**A note on legacy repositories:** If your repository was created before February 2023, your `GITHUB_TOKEN` likely [has **write-permissions** by default](https://github.blog/changelog/2023-02-02-github-actions-updating-the-default-github_token-permissions-to-read-only/). An attacker could not only steal secrets but also push malicious commits directly to your `main` branch.

### The Solution: The "Label Gate"

The safest path is using the standard `pull_request` trigger, but this hides secrets from forks, often breaking legitimate integration tests.

The **Label Gate** solution allows you to keep `pull_request_target` while adding a human-in-the-loop:

1.  A contributor submits a PR.
2.  The CI runs but **fails immediately** at the `verify` step.
3.  A maintainer reviews the code. If it's safe, they add the `safe to test` label.
4.  The maintainer (or contributor) re-runs the CI. Now the action passes, and secrets are exposed only to the code you've vetted.
