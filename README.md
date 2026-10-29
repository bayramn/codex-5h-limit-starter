# Codex 5h Limit Starter

An experimental tool that sends a small Codex prompt after your five-hour usage allowance refreshes. The aim is to start the next window automatically, so it may reset sooner when you return.

## How it works

1. Reads your Codex usage and reset time.
2. Sleeps until 30 seconds after the reset, then checks again.
3. If the five-hour allowance shows 100% remaining, sends “Reply OK.” Otherwise, waits for the next reset.
4. Reuses a dedicated Codex session for later prompts.

It waits if your weekly allowance is exhausted and retries usage checks after errors. Each prompt consumes some allowance and counts toward your weekly limit. It won't send if the reported credit status is uncertain or credits are available.

**Experimental:** The behavior immediately after a real reset and session reuse have not yet been verified. Usage may be delayed or rounded, and a prompt sent at the same time as your own activity could be redundant. This tool cannot guarantee a full allowance or an exact reset time.

## Requirements

- Node.js 18 or later and the Codex CLI on `PATH`.
- A ChatGPT Plus account signed into the CLI (`codex login status`).
- The computer must stay on while the tool is running.

## Run

From the project directory:

```sh
node codex-window.js --dry-run
```

Dry run logs what would happen without sending a prompt. Stop it with `Ctrl+C`, then start the tool:

```sh
node codex-window.js
```

Leave it running; stop with `Ctrl+C`. Only one instance can run at a time, including dry run. It does not automatically restart after a reboot.

An unclean shutdown can leave a lock file; if the tool reports a stale lock and no instance is running, delete `~/.local/state/codex-window/node.lock`.

The session ID and timing state are stored in `~/.local/state/codex-window`. Your existing Codex login is used; the tool does not ask for or store your password.

## Install locally with npm

From a checkout, run `npm install -g .`, then use `codex-5h-limit-starter` (or add `--dry-run`). The package has not yet been published to npm.

You can also install from GitHub:

```sh
npm install -g github:bayramn/codex-5h-limit-starter
```
