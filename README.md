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
# → llama-cpp  ggml-org/gpt-oss-20b-GGUF   32.8K   8K   yes   no
```

### 6. End-to-end test

From any directory with a `README.md`:

```bash
pi --print "Read README.md with the read tool and tell me only the first heading."
```

Expected: the first heading line, returned in ~20 s (cold) or faster (warm). If it
returns the line, tool-calls are working through the full Harmony round-trip.

## Tuning notes

- **Context window**: set to **32768** (32K) in both `llama-server` (`--ctx-size`) and
  the pi extension (`contextWindow`). Verified holding a 26K-token context with no spill
  and no OOM.
- **`--swa-full` is *not* set — headroom beats prefix reuse on 16 GB.** gpt-oss-20b uses
  sliding-window attention (128-token window on alternating layers). `--swa-full` would
  keep full-length KV on every layer so the cross-turn prefix is reused (sub-second
  follow-up prefills instead of a full re-process), but it roughly doubles KV memory. On
  a 16 GB box with `iogpu.wired_limit_mb=14336`, that extra KV is the difference between
  the rest of the machine being usable while a turn runs and not. Without it, every agent
  turn re-prefills the growing conversation (`llama-server` logs `forcing full prompt
  re-processing due to lack of cache data`), which is the cost we're paying for keeping
  ~2 GB more free for the OS. **Trade-off:** on a 32 GB+ machine, or if you mostly do
  single-shot prompts where prefill speed doesn't matter, add `--swa-full` back.
- **Process priority — keep the foreground responsive during generation.** The
  LaunchAgent runs `llama-server` with `ProcessType=Adaptive`, `Nice=5`, and
  `LowPriorityIO=true`. That tells macOS to yield CPU and disk I/O to whatever you're
  actively using when there's contention, so typing/scrolling stays smooth while a turn is
  being generated. No effect on idle memory pressure (the GPU wiring is what it is), but
  it removes the "everything stutters mid-response" symptom.
- **The other RAM-freeing levers** (all in the LaunchAgent args):
  - `--parallel 1`: pi runs a single conversation, so one KV slot, not the auto-selected
    four. (Default is `-1` = auto = 4 on this box.)
  - `--cache-type-k q8_0 --cache-type-v q8_0` + `-fa on`: 8-bit KV cache (needs Flash
    Attention) roughly halves KV bytes/token with negligible quality loss.
  - `--batch-size 1024`: caps the prefill compute buffer. The default (2048) can blow past
    the Metal memory budget and crash with `Compute error` (GPU OOM) once the context is
    large; 1024 trades a little prefill speed for stability.
  - `--cache-ram 0`: disables the 8 GB prompt-reuse cache that `llama-server` reserves by
    default — pure RAM the model can't afford here. (With `--swa-full` off, we don't get
    cross-turn KV reuse anyway, so this cache wouldn't help either.)
- **GPU layers**: `-ngl 99` tells `llama-server` to put all layers on GPU. With the
  sysctl bump from step 3, they all fit.
- **Harmony / reasoning**: `--jinja` is the magic flag that enables gpt-oss's Harmony
  chat template — including reasoning channels (`reasoning_content` field) and proper
  `tool_calls` parsing. Without it, raw channel tokens leak into `content`.
- **First-load time**: cold ~3 s after the model is on disk; the download is the slow
  part (one-time).

## A/B: gpt-oss-20b vs Gemma 4 12B

A second LaunchAgent serves [`unsloth/gemma-4-12b-it-GGUF`](https://huggingface.co/unsloth/gemma-4-12b-it-GGUF)
(UD-Q4_K_XL, 7.37 GB) on the same `:8080`, so you can swap the two and benchmark
on identical server flags. **Why it's worth testing, and what to actually watch:**

- **Don't expect it to be faster.** gpt-oss-20b is a *Mixture-of-Experts* model —
  ~21B total but only **~3.6B active** per token, which is why it hits ~43 tok/s.
  Gemma 4 12B is **dense**: all ~12B activate every token, so despite the smaller
  file it moves ~3× more weight per token and will likely generate **slower**.
  "Smaller GGUF" ≠ "faster decode" once one side is MoE.
- **Its real edge is RAM.** At ~7.4 GB resident it's roughly half gpt-oss's ~14 GB.
  That freed headroom is what makes the dense penalty potentially worth it — enough
  to turn `--swa-full` back on (cross-turn prefix reuse, dropped above to save ~2 GB)
  or widen the KV budget. The swap script keeps flags identical for a clean
  model-vs-model first pass; add `--swa-full` to the gemma plist as a *second* experiment.
- **256K context is not free.** The model card advertises 256K, but context costs
  KV-cache RAM — your binding constraint. Both agents stay at 32K so the comparison
  is fair and fits the box.
- **Judge on tok/s + tool-call reliability**, not vibes. Gemma 4 has native function
  calling and a real system role; whether llama.cpp's bundled template parses its
  `tool_calls` cleanly under `--jinja` is the thing the A/B is really for. Watch the
  `-fa on` + hybrid-attention combo on Apple Silicon — if you see assertion failures
  or garbage, that's the first knob to flip.

One-time install of the second agent + swap helper:

```bash
cp launchagents/com.markhougaard.llama-server-gemma.plist ~/Library/LaunchAgents/
sudo install -m 755 bin/llm-swap /usr/local/bin/llm-swap   # or add ./bin to PATH
```

Then flip between them (each swap stops the other server, starts the target, points
pi's `defaultModel` at it, and waits for `/health`):

```bash
llm-swap gemma      # serve Gemma 4 12B
llm-swap gpt-oss    # back to gpt-oss-20b
llm-swap status     # what's loaded + served model + health
```

Benchmark each with the same prompt and compare tok/s (printed by `llama-server` in
its log) and whether the tool round-trip completes:

```bash
pi --print "Read README.md with the read tool and tell me only the first heading."
```

## Layout

```
launchdaemons/
  com.markhougaard.iogpu-wired-limit.plist   # persistent sysctl (system-level, sudo)
launchagents/
  com.markhougaard.llama-server.plist        # gpt-oss-20b autostart at login
  com.markhougaard.llama-server-gemma.plist  # gemma-4-12b alternate (A/B; same :8080)
bin/
  llm-swap                                    # switch the active model + pi defaultModel
pi/
  extensions/
    llama-cpp.ts                              # registers llama-cpp provider (both models)
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
