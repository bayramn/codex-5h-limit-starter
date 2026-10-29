# Codex 5h Limit Starter

Automatically send a small Codex prompt after your five-hour allowance refreshes, to start the next window sooner.

## Install and run

Requires Node.js 18 or later and the Codex CLI signed in to a ChatGPT Plus account.

```sh
npm install -g codex-5h-limit-starter
codex-5h-limit-starter
```

Keep it running and stop it with `Ctrl+C`. Your computer must stay on; the tool won't restart after a reboot.

## How it works

The tool reads your usage, sleeps until 30 seconds after the reported reset, and checks again. If the five-hour allowance shows 100% remaining, it sends “Reply OK” in a dedicated Codex session. Otherwise, it waits for the next reset. It also waits when the weekly allowance is exhausted.

Each prompt uses a little allowance and counts toward your weekly limit. **This is experimental:** behavior after a real reset and repeated session use have not yet been verified. Usage can be delayed or rounded, so it cannot guarantee a full allowance or an exact reset time.

The session ID and timing state are saved in `~/.local/state/codex-5h-limit-starter`. If an unclean shutdown leaves a stale lock, stop all instances and delete `node.lock` in that directory.
