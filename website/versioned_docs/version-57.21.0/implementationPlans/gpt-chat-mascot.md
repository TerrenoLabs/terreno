# GPTChat optional mascot

**Status:** Complete  
**Roadmap:** Area=`ui`, Target=`Released`, Impact=`Feature`  
**Branch:** `cursor/gpt-chat-mascot-d39f`  
**Owner:** cloud agent  
**Created:** 2026-09-15

## Goal

Let consuming apps brand the GPT screen with their own mascot. Terreno does not ship a default character.

## Non-Goals

- Bundling artwork, Lottie files, or a Terreno fox in `@terreno/ui`
- Animating the mascot from `isStreaming` inside GPTChat (consumers wrap their own node)
- Showing the mascot beside assistant bubbles

## Decisions

| Question | Decision |
|----------|----------|
| Who owns the asset? | Consumer. `mascot?: React.ReactNode` |
| When is it visible? | Only while `currentMessages.length === 0` |
| Default? | Omitted — existing empty chat unchanged |

## UI

`GPTChat` empty-state hero: optional mascot slot, then existing suggested prompts.

## Task List

[docs/tasks/gpt-chat-mascot.md](../tasks/gpt-chat-mascot.md)

## Acceptance Criteria

- [ ] Omitting `mascot` leaves the empty chat unchanged
- [ ] Passing `mascot` shows it on an empty chat, including with suggested prompts
- [ ] Messages hide the mascot
- [ ] Demo story and example app show a consumer node
- [ ] Docs describe the optional slot
