# pi-setup

Local-LLM coding workflow on Apple Silicon: [pi-coding-agent](https://pi.dev) talking to
[gpt-oss-20b](https://huggingface.co/ggml-org/gpt-oss-20b-GGUF) served by `llama-server`
(from `llama.cpp`). One model, full reasoning + tool-calls, ~43 tok/s output, no daemon
overhead.

Tuned and validated on **M1 Pro / 16 GB** — the binding constraint on this class of
machine. Should work unchanged on any newer / larger Apple Silicon.

## Why this stack

We tried several combinations on this hardware in May 2026; here's the matrix that drove
the final choice:

| Backend | gpt-oss-20b? | Tool calls | Output speed | Notes |
|---|---|---|---|---|
| **llama.cpp `llama-server`** | ✅ | ✅ (`--jinja`) | **~43 tok/s** | No daemon; parses Harmony natively |
| Ollama 0.23.2 | ✅ | ✅ | ~10 tok/s | Go daemon + scheduler overhead; 4× slower |
| MLX (`mlx_lm.server` 0.31.3) | ✅ | ❌ | n/a | Lower RAM (10.4 GB vs 14 GB) but does not parse Harmony — tool calls leak as raw `<\|channel\|>…` tokens |
| LM Studio | ✅ | ✅ | — | Works but is GUI / heavier than needed |

llama.cpp wins because it's the only stack on Apple Silicon that's *both* low-overhead
*and* parses the OpenAI Harmony format gpt-oss uses for reasoning + tool calls.

## The one thing that makes this fit on 16 GB

gpt-oss-20b's quantised weights are ~14 GB. macOS's default GPU wired-memory cap
(`iogpu.wired_limit_mb=0`, which resolves to ~67% of RAM ≈ 10.7 GB on 16 GB machines) is
*lower* than that, so Metal silently spills ~27% of layers to CPU and you get ~4 tok/s.

The fix: bump the cap to 14 GB.

```bash
sudo sysctl iogpu.wired_limit_mb=14336
```

That's a runtime change (resets on reboot). To make it persistent, install the
LaunchDaemon in `launchdaemons/com.markhougaard.iogpu-wired-limit.plist` — see step 3
below.

After the bump, all layers stay on GPU and you get ~43 tok/s.

## Install on a new Apple Silicon Mac

Prereqs: macOS (Apple Silicon), Homebrew, Node.

### 1. Install llama.cpp and pi

```bash
brew install llama.cpp node
npm install -g @earendil-works/pi-coding-agent
```

### 2. Authenticate to Hugging Face (optional but recommended)

Anonymous HF downloads are throttled (~10 MB/s). With a read token they're ~40 MB/s+.

```bash
# Get a "read" token at https://huggingface.co/settings/tokens
hf auth login --token hf_xxxxxxxxxxxx
```

The token is cached at `~/.cache/huggingface/token` and picked up by `llama-server` and
any other HF client automatically.

### 3. Make the GPU memory cap persistent

Install the LaunchDaemon so the sysctl is applied at every boot:

```bash
sudo install -o root -g wheel -m 644 \
  launchdaemons/com.markhougaard.iogpu-wired-limit.plist \
  /Library/LaunchDaemons/com.markhougaard.iogpu-wired-limit.plist
sudo launchctl bootstrap system \
  /Library/LaunchDaemons/com.markhougaard.iogpu-wired-limit.plist
```

Verify: `sysctl iogpu.wired_limit_mb` should print `14336`. The plist also logs each
boot's action to `/var/log/iogpu-wired-limit.log`.

> Note: this raises the GPU memory ceiling for the whole system. On a 16 GB machine
> that's ~14 GB available for GPU wiring, leaving ~2 GB for everything else. Don't bump
> higher than 14336 on a 16 GB box; ~87% is already the safe ceiling per Apple's own
> docs.

### 4. Install the llama-server LaunchAgent

```bash
mkdir -p ~/.llama-cpp/logs
cp launchagents/com.markhougaard.llama-server.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.markhougaard.llama-server.plist
```

That starts `llama-server` on port 8080, downloads `ggml-org/gpt-oss-20b-GGUF` on first
run (~11 GB), and `KeepAlive: true` auto-restarts it if it ever crashes.

Verify (give it a minute the first time for the download):

```bash
curl -s http://127.0.0.1:8080/health        # → {"status":"ok"}
curl -s http://127.0.0.1:8080/v1/models | python3 -m json.tool
```

### 5. Wire pi to talk to llama-server

```bash
mkdir -p ~/.pi/agent/extensions
cp pi/extensions/llama-cpp.ts ~/.pi/agent/extensions/llama-cpp.ts
cp pi/settings.json ~/.pi/agent/settings.json
```

Verify:

```bash
pi --list-models | grep llama-cpp
# → llama-cpp  ggml-org/gpt-oss-20b-GGUF   16.4K   8K   yes   no
```

### 6. End-to-end test

From any directory with a `README.md`:

```bash
pi --print "Read README.md with the read tool and tell me only the first heading."
```

Expected: the first heading line, returned in ~20 s (cold) or faster (warm). If it
returns the line, tool-calls are working through the full Harmony round-trip.

## Tuning notes

- **Context window**: pinned to **16384** in both `llama-server` (`--ctx-size`) and the
  pi extension (`contextWindow`). The model's native ctx is 131072, but the KV cache for
  that would exceed available RAM after the weights are loaded. 16K is plenty for any
  single-turn coding task.
- **GPU layers**: `-ngl 99` tells `llama-server` to put all layers on GPU. With the
  sysctl bump from step 3, they all fit.
- **Harmony / reasoning**: `--jinja` is the magic flag that enables gpt-oss's Harmony
  chat template — including reasoning channels (`reasoning_content` field) and proper
  `tool_calls` parsing. Without it, raw channel tokens leak into `content`.
- **First-load time**: cold ~3 s after the model is on disk; the download is the slow
  part (one-time).

## Layout

```
launchdaemons/
  com.markhougaard.iogpu-wired-limit.plist   # persistent sysctl (system-level, sudo)
launchagents/
  com.markhougaard.llama-server.plist        # llama-server autostart at login
pi/
  extensions/
    llama-cpp.ts                              # registers llama-cpp provider in pi
  settings.json                               # defaultProvider=llama-cpp, defaultModel=...
```

## Verification checklist after a reboot

```bash
sysctl iogpu.wired_limit_mb                      # → 14336
launchctl list | grep llama-server               # → PID  0  com.markhougaard.llama-server
curl -s http://127.0.0.1:8080/health             # → {"status":"ok"}
pi --list-models | grep llama-cpp                # → llama-cpp  ggml-org/gpt-oss-20b-GGUF …
```

If all four are green, you're good — `pi` with no flags will use gpt-oss-20b locally.
