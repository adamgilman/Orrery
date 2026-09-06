# Sequence views

Date: 2026-09-06. Status: approved in conversation (messages require a declared connection; messages live on the
view; a sequence is its own diagram with a title and description, as many as the model needs; the still shows the
whole sequence and `play` reveals it).

## The idea

A sequence diagram is a projection of the topology: an ordered list of messages between entities the model
already has, over connections it already declares. One new view type draws it; nothing else in the model changes.

```jsonc
{ "id": "checkout-seq", "type": "sequence", "title": "A customer checks out",
  "description": "The happy path, then the cache is told.",
  "messages": [
    { "from": "web", "to": "api", "text": "POST /checkout" },
    { "from": "api", "to": "db", "text": "insert order" },
    { "from": "db", "to": "api", "text": "ok", "reply": true },
    { "from": "api", "to": "sessions", "text": "clear cart" },
    { "from": "api", "to": "web", "text": "201 Created", "reply": true }
  ],
  "play": { "seconds": 1 } }
```

## Model

- `views[].type` gains `sequence`. A sequence view has `messages` and may have `title`, `description` and `play`
  (`seconds` only: reveal one message per period, looping). `scope`, `only`, `collapse`, `direction` and a
  scenario in `play` are errors on a sequence view.
- A message: `from` and `to` are entities (components or groups); `text` is the label; `kind` names a connection
  kind for the line style and defaults to the connection's own; `reply: true` draws the dashed return.
- Every message runs over a connection the model declares between its ends, in either direction; otherwise an
  error naming the connections that exist. A self-message (`from` = `to`) needs no connection.
- Exports, scenarios, what-ifs, callouts and the heading apply as to any view: a sequence exported at a scenario
  step shows the participants in that step's states, with the legend.

## Drawing (R17)

Participants are the entities the messages touch, in order of first appearance; each head is the entity's own
box (component body, or a group drawn as its closed box), so kinds, shapes, packs and state looks carry over.
A dashed lifeline runs down from each head. Messages are rows in order: an arrow from the sender's lifeline to the
receiver's, labelled above, in the line style of its kind; a reply is dashed with the same arrowhead; a
self-message is a small loop. A call opens an activation bar on its receiver and the receiver's reply closes it;
a call with no reply stays active to the end. Columns are spaced by the widest label between them. Layout is a
pure function in core; no engine is involved.

`play` reveals the messages one per period as CSS visibility keyframes, looping, so the file plays in an image
tag; a still shows everything. In the interactive file the brackets and `next`/`prev` step the messages of a
sequence view, `play` reveals them on the view's period, and the snapshot reports `message: { index, count }`.
Callouts may point at participants. A tour may show a sequence view as a scene, crossfading like any other view.

## Not in this slice

Messages that carry a moment (a `set` mid-sequence), the `walkthrough` view (the same messages as a token on the
topology), group bands behind the lifelines, callouts at a message.
