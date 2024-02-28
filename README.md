# Actions Governance

This repository enforces an oppinionated view of compliance on custom actions within an organization

The actions that this targets are assumed to be cloned copies of open source repositories but that is not required

## Usage

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron:  '30 5,17 * * *'


jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: chocrates-test-org/actions-governance@main
        with:
          token: ${{ secrets.ORG_TOKEN }}
          organization: 'chocrates-test-org'
```
Or using a GitHub App

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron:  '30 5,17 * * *'


jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.PRIVATE_KEY }}
          github-api-url: "https://github.acme-inc.com/api/v3"

      - uses: chocrates-test-org/actions-governance@main
        with:
          token: ${{ steps.app-token.outputs.token }}
          organization: 'chocrates-test-org'
```

## Compliance

For the purposes of this tool compliance looks for 3 things:
- Does the action have Advanced Security enabled?
- Does the action have a CodeQL workflow?
- Does the action have any unresolved CodeQL or dependabot alerts?

If the answer is no to any of these then the action is considered non-compliant

## Remediation

When a repository is found to be non compliant a few things happen.

Firstly the tool looks at the description of the repository.  If it is a link to the upstream repository then the tool will attempt to pull the latest code from the default branch upstream, push it into a new branch in the action, and finally open a Pull Request.
If there are admin's associated to the action they will be marked as reviewers on the PR, if there are not, the Organization Owners are added as reviewers.
This is done in an attempt to help remediate alerts if they have been fixed upstream.

Regardless of whether or not a PR was able to be opened, an issue is created that will warn the owners of the action that it is non compliant and will be soon disabled
After 3 issues have been opened it will attempt to make the action inaccessible (if it is internal or private) and open an issue saying it has been disabled.  
*Note:* Currently public actions will remain accessible.
