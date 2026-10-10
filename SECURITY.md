# Security policy

## Reporting

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). Do not open a public issue for
anything that lets a stranger read a thread, a member reach an admin
screen, or a key leave a box.

Include: the path or frame, what you sent, what came back, and the
commit you tested. A proof of concept against your own deployment is
ideal; do not test against someone else's.

Expect an acknowledgement within 72 hours and a fix or a written
decision within 30 days. Credit in the release notes unless you ask
otherwise.

## Scope

This repository: the Worker (`app/`, `lib/`, `edge/`, `worker/`), the
harness and its MCP plugins (`harness/`), the site (`site/`), and the
workflows (`.github/`). The native apps live in `gantree2-apps` and have
their own policy.

## Supported

`main` and the latest tagged release. Older tags get no backports.

## What we chose and why

[docs/security.md](docs/security.md) — the threat model, every security
choice with its accepted risk, the secrets table, and the open items.
Read it before reporting that we did not do X; it may be in **Not this**
with a reason, and you may still disagree.
