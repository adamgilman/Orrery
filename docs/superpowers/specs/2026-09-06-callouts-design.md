# Callouts

Date: 2026-09-06. Status: built 2026-09-06 (everywhere; automatic placement with an override; plain note).

## The idea

A callout is a short text pointing at one thing in the picture: `{ "at": "db", "text": "Primary is down; reads
move to the replica" }`. It is the author's explanation of a moment, visible on the drawing, where a reason is a
tooltip and a caption is one sentence about the whole picture.

## Model

- `Callout { at, text, side? }`. `at` is an entity id or a connection id. `side` is `top`, `right`, `bottom` or
  `left` and pins the note; without it the note goes to the side with the most free room.
- Where: a scenario step (`callouts` next to `set`, `restore`, `load`), a tour scene, an export's what-if, and the
  top level of the model for standing annotations drawn on every picture.
- Per moment, not cumulative: the picture of step 2 shows step 2's callouts and the standing ones, not step 1's.
  `declare` folds them the way it folds states: standing, then the step's, then the what-if's.
- A view scopes callouts like connections: one whose target is inside a closed group points at the closed box; one
  whose target is not drawn is dropped.

## Drawing

A note: 12px text in the caption ink wrapped to 200px, a white box with the diagram's grey outline, a leader line
with the arrowhead the edges use, from the note's facing edge to the target's nearest edge (or to the label point
of a connection). Placement tries right, bottom, left, top and takes the candidate overlapping the least with
nodes, closed boxes and earlier notes, never above or left of the canvas; the canvas grows for a note past the
right or bottom edge. In play each step's layer carries its own. In a one-drawing tour the callouts are one set
per scene, arriving and leaving in the staged phases like captions. In the interactive file every step's callouts
are in each layer, hidden, and the runtime shows the current step's.

## Invariant

R16: a callout is drawn at the moment it was declared for, pointing at what it names or at the closed box standing
for it, placed where there is room unless the author says which side; the canvas grows to hold it.
