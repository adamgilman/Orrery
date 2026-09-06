# Orrery plugin for Claude Code

One skill, `orrery-diagrams`, that teaches Claude to write an Orrery model (`*.orrery.json`), check it with the
validator's pointer errors, and render or export the pictures. The JSON Schema is the reference; the skill carries
every variant with a worked example so Claude knows what the model can say.

```sh
claude plugin marketplace add adamgilman/Orrery
claude plugin install orrery@orrery
```

Then ask for an architecture diagram, or say "draw this system with Orrery", "add a failure scenario", "open the
cache in a tour". The skill runs `npx orrery-diagrams` for validation and rendering; Node 22 or newer is needed.
