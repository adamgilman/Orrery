# Security

Orrery renders files you give it into SVG. A model file is untrusted input. The renderer escapes every string from
the model; a custom glyph's markup is parsed and rebuilt from an allowlist of drawing elements and attributes
(shapes, groups, gradients, clips, masks, filters; `href` and `url()` only to an id inside the glyph), so script,
event handlers, SMIL animation, links, foreignObject, image, external references, comments and entities never
reach the output; and the standalone file carries no HTML. The interactive
file contains the engine as a script and the model as JSON; open only files you trust, as with any SVG.

To report a vulnerability, email adam.gilman@gmail.com rather than opening a public issue. You will get a reply
within a week, and a fix or a plan before anything is published. Please include a model file that shows the
problem where you can.
