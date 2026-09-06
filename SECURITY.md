# Security

Orrery renders files you give it into SVG. The renderer escapes every string from the model, refuses script,
foreignObject, image and event handlers in custom glyphs, and the standalone file carries no HTML. The interactive
file contains the engine as a script and the model as JSON; open only files you trust, as with any SVG.

To report a vulnerability, email adam.gilman@gmail.com rather than opening a public issue. You will get a reply
within a week, and a fix or a plan before anything is published. Please include a model file that shows the
problem where you can.
