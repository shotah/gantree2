# Security

## Reporting

Report a hole in private. On this repository use **Security → Report a
vulnerability**. A public issue is the wrong place. The private report
form is https://github.com/shotah/gantree2/security/advisories/new.

Include the path or frame, what you sent, what came back, and the
commit you tested. A proof of concept against your own deployment is
enough. Do not test against someone else's.

Expect an acknowledgement within 72 hours and a fix or a written
decision within 30 days. Credit in the release notes unless you ask
otherwise.

## Scope

This repository is the Worker (`app/`, `lib/`, `edge/`, `worker/`), the
brain (`brain/`), the site (`site/`), and the workflows (`.github/`).
The native apps live in `gantree2-apps` and have their own policy.

## Supported

`main` and the latest tagged release. Older tags get no backports.

## What we chose and why

What we chose, the secrets table, and the open risks are
[docs/security.md](docs/security.md). Read it before reporting that we
did not do X. It may be in **Not this** with a reason, and you may
still disagree.
