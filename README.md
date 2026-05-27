![OmegaClaw banner](/docs/assets/banner.png)

# OmegaClaw Core

OmegaClaw Core is a portable MeTTa/AtomSpace runtime for building persistent
neural-symbolic agents.

It is not a chatbot wrapper. OmegaClaw treats the LLM as a cognition provider,
while identity, memory, skills, reasoning state, action boundaries, and trace
remain in the symbolic substrate. Python, shell, channel adapters, web search,
and remote-agent transports are membranes: they let the substrate sense and act
without becoming hidden cognition.

This branch focuses on making the core work out of the box as a coherent
research substrate: exact raw history, bounded context views, inspectable skill
affordances, safer command parsing, restart-persistent runtime spaces, and
default-off optional modules.

## What This Version Adds

- Persistent MeTTa/AtomSpace runtime with explicit memory, identity, reasoning,
  action, provider, and module boundaries.
- Typed command syntax membrane that converts model output into safe MeTTa
  skill calls or explicit syntax errors.
- Symbolic skill affordance directory with skill cards, topics, args, risks,
  effects, triggers, and self-description.
- Input-aware memory and skill recall that adds relevant hints to the active
  context without replacing deliberate memory checks.
- Bounded context views with mechanical payload compaction while preserving raw
  history exactly on disk.
- Runtime spaces for agenda, beliefs, world, events, activity, assumptions,
  attention, skills, scratch, and optional modules.
- Core web-search surface, PLN/NAL guidance, continuity pinning, syntax
  recovery hints, and memory merge helpers.
- Optional module loader boundary so installed extensions remain invisible until
  explicitly enabled.

## Repository Shape

The main branch is intended to be reviewable as a complete out-of-box readiness
snapshot. Individual patch families are also kept on separate branches so
reviewers can inspect or cherry-pick smaller pieces:

- syntax command membrane
- runtime memory and context boundary
- symbolic skill discovery
- input-aware context routing
- module loader boundary
- optional remote-agent module

Generated runtime memory, logs, local deployment files, private channel
configuration, and experimental body modules should not be committed to core.

## Installation

Prerequisites:

- Git
- Python 3 with `venv`
- SWI-Prolog 9.1.12 or later

Install through a PeTTa checkout:

```bash
git clone https://github.com/trueagi-io/PeTTa
cd PeTTa
mkdir -p repos
git clone <omegaclaw-core-repo-url> repos/OmegaClaw-Core
git clone https://github.com/patham9/petta_lib_chromadb.git repos/petta_lib_chromadb
cp repos/OmegaClaw-Core/run.metta ./
```

Create a Python environment:

```bash
python3 -m venv ./.venv
source ./.venv/bin/activate
```

Install CPU PyTorch if you do not want local embeddings to use GPU packages:

```bash
python3 -m pip install --index-url https://download.pytorch.org/whl/cpu torch
```

Install OmegaClaw dependencies:

```bash
python3 -m pip install -r ./repos/OmegaClaw-Core/requirements.txt
```

## Running

Choose an LLM provider and export the required API key before starting the
system.

| Provider | Env Var | Notes |
|---|---|---|
| `Anthropic` | `ANTHROPIC_API_KEY` | Claude models through Anthropic. |
| `OpenAI` | `OPENAI_API_KEY` | GPT models and optional OpenAI embeddings. |
| `ASICloud` | `ASI_API_KEY` | ASI Cloud inference endpoint. |
| `ASIOne` | `ASIONE_API_KEY` | ASI:One inference endpoint. |
| `Ollama-local` | `OLLAMA_API_KEY` | Local Ollama-compatible endpoint. |
| `OpenRouter` | `OPENROUTER_API_KEY` | OpenRouter-compatible models. |

Start from the PeTTa root:

```bash
OMEGACLAW_AUTH_SECRET=<channel-secret> sh run.sh run.metta IRC_channel="<irc-channel>"
```

Then join the configured IRC channel and authenticate with:

```text
auth <channel-secret>
```

Most runtime settings can be overridden as MeTTa command-line arguments:

```bash
sh run.sh run.metta provider=OpenAI LLM=gpt-4.1 commchannel=irc IRC_channel=##omegaclaw
```

## Core Configuration

| Parameter | Default | Meaning |
|---|---|---|
| `maxNewInputLoops` | `12` | Turns the agent keeps running after a fresh human message before idling. |
| `maxWakeLoops` | `6` | Extra warm autonomous turns granted on a scheduled wake. |
| `sleepInterval` | `3` | Delay between loop iterations in seconds. |
| `wakeupInterval` | `900` | Idle time before a scheduled wake in seconds. |
| `maxOutputToken` | `6000` | Output cap passed to the provider. |
| `reasoningMode` | `medium` | Reasoning-effort hint where supported by the provider. |
| `maxFeedback` | `50000` | Last-skill-result text included in active context. |
| `maxHistory` | `30000` | Bounded tail of exact raw history included in active context. |
| `embeddingprovider` | `Local` | Local embeddings or optional OpenAI embeddings. |

## Channels

Core includes IRC, Telegram, Slack, Mattermost, mock, and web-search adapters.
Channel credentials and deployment endpoints should be supplied at runtime, not
committed.

| Parameter | Default | Meaning |
|---|---|---|
| `commchannel` | `irc` | Active communication channel. |
| `IRC_channel` | `##omegaclaw` | IRC channel to join. |
| `IRC_server` | `irc.quakenet.org` | IRC server hostname. |
| `IRC_port` | `6667` | IRC port. |
| `IRC_user` | `omegaclaw` | IRC nickname. |
| `TG_BOT_TOKEN` | empty | Telegram bot token. |
| `TG_CHAT_ID` | empty | Optional Telegram chat ID. Empty supports auto-bind. |
| `SL_BOT_TOKEN` | empty | Slack bot token. |
| `SL_CHANNEL_ID` | empty | Optional Slack channel ID. Empty supports auto-bind. |
| `MM_URL` | empty | Mattermost base URL. Set at runtime. |
| `MM_CHANNEL_ID` | empty | Mattermost channel ID. Set at runtime. |
| `MM_BOT_TOKEN` | empty | Mattermost bot token. |

## Documentation

Start with [`docs/README.md`](./docs/README.md). It links the conceptual
introduction, tutorials, API reference, testing and benchmark notes, and review
materials. Release notes for this readiness branch are in
[`CHANGELOG.md`](./CHANGELOG.md).

## Safety Note

OmegaClaw is experimental autonomous-agent infrastructure. Depending on
configuration, it can read and write files, execute shell commands, access
network resources, send messages, call providers, and load optional modules.
Run it in an isolated environment, commit no secrets, and grant only the
permissions needed for the experiment you are actually running.

OmegaClaw is provided as-is under the repository license.
