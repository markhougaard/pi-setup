# pi-setup

Portable configuration for a local-LLM coding workflow on macOS / Apple Silicon, using [pi-coding-agent](https://pi.dev) on top of [Ollama](https://ollama.com).

Tuned for **M1 Pro 16 GB** (the Metal working-set ceiling is ~10.2 GiB). Should work on larger machines unchanged.

## What this gives you

A three-mode model cycle bound to `shift+tab` in pi:

```
Fast (gemma4-fast)  →  Plan (gemma4-think)  →  Code (qwen-coder)
   daily driver         planning, writes        implementation,
   ~27 tok/s            PLAN.md to cwd          reads PLAN.md
                                                Qwen3 14B base
                                                ~12 tok/s
```

Plus:
- Auto-pinning of `gemma4-fast` at login via a LaunchAgent
- `auto-plan` extension that captures Plan-mode output into `PLAN.md`
- `OLLAMA_FLASH_ATTENTION` and `q8_0` KV cache enabled

## Install on a new machine

Prereqs: Homebrew and Node (`brew install node`).

```bash
git clone <repo-url> ~/dev/pi-setup
cd ~/dev/pi-setup
./bootstrap.sh
```

The script is idempotent — re-run any time. It will:

1. Verify Homebrew, install `ollama` if missing, start the service
2. Install `@earendil-works/pi-coding-agent` globally if missing
3. Pull the two base models (~19 GB total)
4. Build the three custom models from `modelfiles/`
5. Install the three Pi extensions and the keybindings file into `~/.pi/agent/`
6. Install and load the prime LaunchAgent
7. Pin `gemma4-fast` in memory immediately

## Layout

```
modelfiles/
  gemma4-fast     # daily driver — Gemma 4 e4b, Google's recommended sampling, no repeat penalty
  gemma4-think    # planning — adds <|think|> + planning-only system prompt + PLAN.md trailer
  qwen-coder      # implementation — Qwen3 14B dense, 6-rule pragmatic-coder system prompt
pi/
  extensions/
    ollama.ts      # registers Ollama as a Pi provider
    think-toggle.ts # shift+tab cycles Fast → Plan → Code; re-pins on Fast
    auto-plan.ts   # captures Plan output into PLAN.md
  keybindings.json # unbinds shift+tab from app.thinking.cycle
launchagents/
  com.markhougaard.ollama-prime.plist  # re-pins gemma4-fast at login
bootstrap.sh
```

## Verifying after install

```bash
# Models present
ollama list | grep -E "gemma4-fast|gemma4-think|qwen-coder"

# Pinned model resident in VRAM
curl -s http://localhost:11434/api/ps | python3 -m json.tool

# Pi sees the extensions
pi list

# Cycle works: launch pi, press shift+tab three times — toast should rotate
pi
```

## Hardware notes

- These models can't all be co-resident in 16 GB; switching cycles a 5–9 s cold load
- `qwen-coder` is the slow one (~12 tok/s on Qwen3 14B) — `gemma4-fast` is the daily driver (~27 tok/s)
- On 24 GB+, `gemma4-fast` and one other model could co-reside; the cycle would feel instant

### What doesn't fit (tried and rejected)

These are the hardware boundaries we hit during a May 2026 migration attempt — keep them in mind before pulling new models:

| Model | Size | Result |
|-------|------|--------|
| `gpt-oss:20b` (OpenAI, MoE) | 13.2 GB | Loads but only 22/25 layers on GPU; ~1 tok/s steady state |
| `mychen76/phi4_cline_roocode:14b` | 9.1 GB | Fits, fast, but emits Cline-XML tool calls — Pi/Ollama can't parse them |
| `phi4:14b` (base Microsoft) | 9.1 GB | No `tools` capability declared |
| `devstral-small-2:24b` | 15 GB | Exceeds Metal ceiling by ~5 GB — don't even try |

**Hard rule for this hardware: model file ≤ ~9.5 GB.** The Metal working-set ceiling is ~10.2 GiB and you need ≥0.5 GB for KV cache at 8K context.

## Workflow

1. **Plan**: `shift+tab` to Plan mode, ask for a plan. PLAN.md is auto-written to cwd.
2. **Code**: `shift+tab` to Code mode. `qwen-coder` reads PLAN.md (rule #1 in its system prompt) and implements against it.
3. **Done**: `shift+tab` back to Fast. The daily driver is re-pinned automatically.
