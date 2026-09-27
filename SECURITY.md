# Security policy

## Supported versions

Fixes are made on the latest commit of `main`. If you run your own copy, update to it before reporting.

## Reporting a vulnerability

Please report it privately: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue or pull request for it.

Helpful details:

- what an attacker can do, and what they need first (an account, a role, a workspace, a link)
- the steps or requests that show it
- the commit you tested

You'll get an acknowledgement within a week, and a fix or a plan as soon as the problem is confirmed.

## What is in scope

The application in this repository: sign-in and sessions, two-step sign-in and recovery codes, API tokens, invites and password resets, the access policy (roles, workspaces, private runs), recipe validation and execution, file handling, and the deployment kits in `deploy/` and `fly.toml`.

These are intentional and not vulnerabilities:

- The demo accounts and their password `flowpilot-demo` are public. They exist only when `DEMO_MODE` is on, and their password, name and memberships can't be changed.
- Rate limits live in the server's memory and reset on restart, as documented in the README.

How the app defends itself (hashing, cookies, the origin check, the access policy, database triggers) is described in [docs/system-design.md](docs/system-design.md#8-security-model) and in the README's [Security and privacy](README.md#security-and-privacy) section.
