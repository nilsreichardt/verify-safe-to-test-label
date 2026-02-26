# verify-safe-to-test-label

<a href="https://codecov.io/gh/nilsreichardt/verify-safe-to-test-label"><img src="https://codecov.io/gh/nilsreichardt/verify-safe-to-test-label/branch/main/graph/badge.svg" alt="codecov"></a>

A GitHub Action that verifies if the `safe to test` label is assigned to a Pull Request before running sensitive steps.

If you are using `pull_request_target` in your workflows, there is a high probability your repository is vulnerable to secret exfiltration. This action acts as a manual "Gatekeeper" to protect your infrastructure.

## Quick Start

1.  Add the `labeled` type to your `pull_request_target` trigger.
2.  Add `nilsreichardt/verify-safe-to-test-label@v1` to the start of your job.
3.  **Highly Recommended:** Pair this with [remove-safe-to-test-label](https://github.com/nilsreichardt/remove-safe-to-test-label) to prevent "Bait & Switch" attacks (where an attacker pushes malicious code _after_ you've already approved the PR).

```yaml
on:
  pull_request_target:
    types: [opened, synchronize, reopened, labeled]

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    permissions:
      # Required for remove-safe-to-test-label
      contents: read
      pull-requests: write
    steps:
      # 1. Reset the gate: Remove label if this is a new commit (synchronize)
      - name: Remove "safe to test" label, if PR is from a fork
        uses: nilsreichardt/remove-safe-to-test-label@v1
        with:
          label: "safe to test" # optional, default is "safe to test"

      # 2. Check the gate: Stop here if the label isn't present
      - name: Ensure PR has "safe to test" label, if PR is from a fork
        uses: nilsreichardt/verify-safe-to-test-label@v1
        with:
          label: "safe to test" # optional, default is "safe to test"

      # 3. Securely run your tests
      - name: Checkout PR code
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          repository: ${{ github.event.pull_request.head.repo.full_name }}

      - name: Test with Secrets
        run: npm install && npm test
        env:
          STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}
```

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

---

## Inputs

| Name    | Description                                      | Default        |
| ------- | ------------------------------------------------ | -------------- |
| `label` | The name of the label required to pass the check | `safe to test` |

## Recommended Pairings

To ensure a complete security loop, use this in conjunction with:

- **[remove-safe-to-test-label](https://github.com/nilsreichardt/remove-safe-to-test-label):** Automatically strips the label when new commits are pushed, forcing a re-review of any new code changes.
