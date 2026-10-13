# Tyria Projects

The Tyria Projects plugin adds a **Tyria Projects** sidebar to BB, a `bb tyria`
CLI, and native agent tools for authorized projects, dynamic boards, tasks,
comments, and approved screenshot analysis.

The integration uses OAuth 2.1 Device Authorization. Access tokens and the
in-flight device code remain in server memory. The rotating refresh token is a
BB secret setting and is never exposed to the app, CLI output, realtime events,
or agent tools. One local BB installation supports one Tyria grant.

The default issuer is `https://www.sandbox.tyriacore.app` and the default public
client ID is `tyria-bb`. Operations must provision that public client in every
Tyria environment before real sign-in can work. Configure a different exact
origin or public client ID from BB plugin settings; no client secret is used.

Open **Tyria Projects**, select **Connect Tyria**, open the verification page,
and approve the displayed code and scopes. The panel then shows only the
projects and actions Tyria authorizes for the connected account/workspace.
Task detail responses omit comment and attachment counts when the connected
account lacks the corresponding permission; omission means restricted, not
zero.

Agent writes always show a BB confirmation form before the request is sent.
Screenshot analysis asks again before BB downloads the selected PNG/JPEG and
sends its pixels to Meta Muse, where the content may become part of the Muse
conversation history. Browser previews use a fixed, locally authenticated POST
route with an opaque 30-second single-use ticket. The public BB plugin RPC
context does not expose an authenticated browser-session identity, so the panel
generates a cryptographically random nonce per mounted task view, keeps it only
in React memory, and binds each ticket to its server-side SHA-256 digest. The
same nonce must accompany the preview POST body; a mismatch consumes and rejects
the ticket. This is an ephemeral browser-instance binding, not an authenticated
user or BB-session identity. A future host-provided opaque client identity would
be the stronger replacement.

CLI reads support `--json`. Writes, disconnect, and attachment downloads require
`--yes`; inline task descriptions and comment text enter shell history, so use
`--description-stdin` and `--text-stdin` when practical. The current BB plugin
CLI host has no safe interactive stdin confirmation callback. Without `--yes`,
the command stops before any network mutation or download, prints a bounded
structural target summary, and tells you to review it and rerun with `--yes`.
Run `bb tyria --help` for the complete command list.
