# pi-setup

Config + tuning for running a local coding agent on Apple Silicon: **pi** →
**gpt-oss-20b** served by `llama-server` (llama.cpp). Tuned for **M1 Pro / 16 GB**, the
binding constraint. Full rationale is in `README.md`; this file is the operating summary.

## Hard constraints (don't fight these)
- 16 GB RAM. GPU wired cap `iogpu.wired_limit_mb=14336`; weights are ~14 GB → headroom is
  ~2 GB. Don't raise the cap past 14336 on this box.
- `--ctx-size 32768` is the hard ceiling. KV cache is the scarce resource — prompts over
  32K get a clean HTTP 400, not a crash. Keep added tools/context lean.

## The server speaks TLS
- `llama-server` runs on `https://127.0.0.1:8080` with an mkcert cert.
- `curl` needs `-k`. pi/Node needs the mkcert CA — the `com.markhougaard.node-ca-env`
  LaunchAgent publishes `NODE_EXTRA_CA_CERTS` at login. New terminals inherit it; restart
  an old terminal if pi throws `Connection error`.

## Commands (`bin/`)
- `llm-swap gpt-oss | gemma | status` — switch the served model (one fits at a time),
  syncs pi's `defaultModel`, waits for health.
- `ab-eval` — run `eval/prompts/*` through the served model → `eval/results/<model>/`.
- `prefill-probe` — verify cross-turn prefix reuse (prefilled tokens on a follow-up).
- `ctx-stress` — find the GPU-OOM ceiling (full-window prefill).

## Verified facts — trust these, don't re-investigate (2026-06)
- **Prefix reuse works** without `--swa-full`: a follow-up on a 7.4K-token context
  prefilled only 17 tokens. Don't re-add `--swa-full` for "prefill speed" — you'd just
  spend ~2 GB for nothing. (Lost only on a server restart.)
- **OOM-stable** with `--batch-size 1024`: prefilled a full 31.5K context, zero OOM. Every
  historical OOM in `server.log` was on the untuned default `n_batch=2048`. Don't raise it.
- **gpt-oss-20b > Gemma 4 12B here**: ~2× faster (MoE ~3.6B active vs dense 12B) and it
  produced working code where Gemma didn't (`eval/results/`). gpt-oss is the daily driver.
- **Gemma needs `--no-mmproj`**: this llama.cpp build can't load its `gemma4uv` vision
  projector and crash-loops without the flag.

## Gotchas
- gpt-oss reasoning + tool calls need `--jinja` (Harmony template). Without it, channel
  tokens leak into content.
- 8-bit KV cache (`--cache-type-k/v q8_0`) requires `-fa on`.

## Changing tuning? Verify it.
After editing the plist or extension, reload the LaunchAgent and re-run the relevant probe
(`prefill-probe` / `ctx-stress`) — the README's tuning claims are backed by those, keep them
true. Don't assert a config "helps" without a measured before/after.
