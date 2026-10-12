# Emoji reactions

Both directions: the agent reacting to the human's message, and the human
reacting to the agent's. Cab is not in this repo ([todo.md](todo.md) §0).

## Where it stands

| | Chat (this repo) |
| --- | --- |
| Human reacts to the agent | The PWA sends `{ kind: "react", id, text }`. The DO stores it and fans it to that person's other mouths. The harness takes it as a turn (`handleInbound`). |
| Agent reacts to the human | The harness emits `react` on the inbound id. The DO fans it to that person's phones. |

## The rule

A reaction is a reply. It is the acknowledgment the persona already bans
as text ("never a bare 'got it' / 'yes boss'") — allowed because it costs
the human nothing to read and costs the model five tokens to write.

- **Agent → human.** When the honest reply is an acknowledgment — noted,
  thanks back, nice, will do — react and write nothing. React *and* write
  when there is something to add: the wake that got set, the one question.
  Never as a substitute for a tool call or an answer. Not on `[input]
  spoken` turns; there is nothing to see in a car.
- **Human → agent.** Their 👍 on your message is not a question. It costs a
  model call only when it might change something: you were waiting on
  them, or the reaction is negative. Everything else is recorded and
  stays silent.

## Agent → human: the `[react …]` token

Same family as `[wait]` / `[nowait]` / `[silent]`: an own-line (or
trailing) reply token, not a tool.

```text
[react 👍]
```

```text
Set a 6pm wake to ask how it went.
[react 👍]
```

**Kernel.**

The harness strips `[react …]` from the text the phone sees and emits a
`react` frame with the emoji. History stores the raw reply, so the
model later sees `[react 👍]` as its own turn. An `[input] spoken`
turn, or an emoji off the palette, sends the emoji as the text when
there is no other text, and drops it when there is.

**Persona.** One section beside `## Follow-up`, written by the harness,
not per persona file:

```markdown
## Reactions (`[react 👍]`)

- **Not a tool.** When the honest reply is an acknowledgment — noted,
  thanks back, nice, will do — put `[react <emoji>]` on its own line and
  nothing else. They see the emoji on their message, never the token.
- React and write only when there is something to add: `[react 👍]` plus
  the one line that matters.
- Not on `[input] spoken` turns. Not instead of a tool call or an answer.
- `[reaction] 👍 on: …` as *their* turn is them reacting to you. On a
  question you asked, 👍 / ❤️ is yes and 👎 is no — act on it, do not ask
  again. A 👎 elsewhere: fix or offer to, one line. Otherwise `[silent]`.
```

The palette the model is told about: `👍 👎 ❤️ 🔥 🤣 😢 🤔 🙏 👀 🎉 💯 👏`.
It can say no, cry, or shrug. The phone picker shows the same list.

**Chat.** Outbound frame
`{"kind":"react","user_id":…,"id":<human's inbound frame id>,"text":"👍"}`.
The Agent DO fans it to phones and stores it on the transcript. The
PWA and Cab paint a chip on the human bubble. Telegram, Discord, and
Slack are not ported ([channels.md](channels.md)).

## Human → agent

**Chat inbound.** `{"kind":"react","user_id":…,"id":<agent frame
id>,"text":"👍"}`. Empty `text` = cleared.

`reply` frames carry an `id` (as `push` already does) and the harness
keeps a small recent ring of `id → text`. `push` ids are kept too
(a 👍 on a morning cron is the common case). Unknown id →
`[reaction] 👍 on: (unknown message)`; still handled.

**Settle.** A short quiet, latest set wins, empty set cancels, keyed
per user and message.

**Kernel triage — the cost rule.** On a `[reaction]` turn, before any
model call (`agent.triageReaction`):

| Session | Emoji | Action |
| --- | --- | --- |
| `waiting_for_reply=false` | all positive / neutral (`👍 ❤️ 🔥 😂 🙏 👏 💯 ✅ 🎉 😍 🤣 👀`) | **No model call.** Append the `[reaction]` user line and a `[silent]` assistant line to history (keeps alternation; reads as what the model would have said). Log `reaction silent skip` and a zero-cost `turn perf` (`source=reaction outcome=silent iterations=0`). |
| `waiting_for_reply=true` | any | Model turn. Their reaction is their reply: the wait clears and the follow-up pokes cancel first, as for a text reply. The persona line says 👍 / ❤️ = yes, 👎 = no. |
| any | any negative / uncertain (`👎 ❓ 😕 🤔 😡 😢`) or unknown (custom emoji) | Model turn. |

The alternative — every reaction to the model, persona steering it to
`[silent]` — is simpler and costs ~15k tokens per 👍. Declined.

Debounce is the settle above; there is no second "wait for a follow-up
text" timer. A text that follows a reaction sees the reaction in history
on its own turn.

## Eval

The eval sees the emoji as `reaction=`, not in the text. Expectations:
`react` (an emoji, or `*`), `react_only` (emoji and no text),
`no_model_call` (the kernel settled it; rounds must be 0); fixture
field `waiting` arms the wait before the turn. How to run it:
[eval_setup.md](eval_setup.md).

- `05_thanks_sounds_good`: a tool, a next question, or `[react 👍]` alone —
  never a bare "got it" in text.
- `12_react_to_thanks`: the thing is done, they say thanks → `react_only`.
- `13_reaction_idle_thumbs_up`: their 👍 on a done message → `no_model_call`,
  silent.
- `14_reaction_waiting_thumbs_up`: `waiting: true`, their 👍 on "block
  Thursday 7–8?" → the event is created, no question, wait cleared.
- `15_reaction_thumbs_down`: their 👎 on "Blocked Thursday 7–8 for the
  gym." → not silent; the event moved or deleted, or one question. (The
  scenario is a calendar block, not a wake, so the world state lives in a
  canned tool result: a fixture whose history says "wake set" while
  `[wakes]` is empty reads to the model as "you didn't", and it fixes that
  instead.)

12, 14 and 15 are live-model fixtures (`npm run eval`). 13 and the
plumbing of all four run on the scripted completer under `test/harness/`.

## Decided (2026-09-17)

1. Palette: the fixed list above, negatives included.
2. Triage: kernel short-circuit for idle positive reactions; waiting or
   negative goes to the model.
3. `thanks_sounds_good`: `[react 👍]` alone passes.
4. Wire: `react` kind with `user_id` / `id` / `text`. `reply` frames
   carry an id. The Agent DO, the PWA, and Cab share that shape.
