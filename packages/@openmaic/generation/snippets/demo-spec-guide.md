## Output contract

Your whole reply is ONE JSON object, a DemoSpec. Start with `{` and end with `}`. No Markdown fences, no prose before or after, no comments, no trailing commas. Do not call tools and do not write HTML or JavaScript: a vetted runtime (the demo kit) renders the spec.

Top level:

| Field | Type | Notes |
|---|---|---|
| `version` | `1` | always the number 1 |
| `kind` | `"scene3d"`, `"flow"` or `"preset"` | |
| `title` | string | short, in the lesson's language |
| `preset`, `params` | string, object | only for `kind: "preset"` (see the catalogue) |
| `direction` | `"right"` or `"down"` | flow only, layout direction (default right) |
| `objects` | array | required for scene3d and flow, `[]` for a preset |
| `steps` | array | required for scene3d and flow, `[]` for a preset |
| `controls` | array | optional, at most 3 |

Ids: every object id and every step id is unique, 1-64 characters, letters, digits, `-` or `_` (for example `a`, `xor`, `s1`). Every reference (`from`, `to`, `parent`, `show`, `hide`, `pulse`, `highlight`, `move`, `camera`, `set` keys, `travel`, control `bind`) must name an object id that exists. Text fields are at most 500 characters.

Colours: one of `accent`, `blue`, `orange`, `teal`, `yellow`, `vermilion`, `purple`, `sky`, `neutral`, or `#rrggbb`. Prefer the names; they follow the light and dark theme.

### Steps (both scene3d and flow)

Each step is `{ "id": ..., ...verbs }`. A step changes the scene from the previous step's state; later steps keep what earlier steps set.

| Verb | Value | Effect |
|---|---|---|
| `caption` | string | the sentence shown under the stage for this step |
| `set` | `{ "<objectId>.<prop>": value }` | prop is one of `value`, `label`, `color`, `visible`, `x`, `y`, `z`, `scale`; value is a number, string or boolean (`color` must be a colour) |
| `show`, `hide` | `[objectId, ...]` | fade objects in or out (start them with `"hidden": true` to reveal later) |
| `move` | `{ "<objectId>": [x, y, z] }` | scene3d: tween to a position |
| `pulse` | `[objectId, ...]` | a short pulse; on a `wire` a bead runs along it |
| `highlight` | `[objectId, ...]` | glow these objects for this step |
| `camera` | objectId, `"overview"`, or `{ "position": [x,y,z], "target": [x,y,z] }` | scene3d: frame one object, the whole scene, or an explicit pose |
| `travel` | `{ "<tokenId>": "<edgeId or nodeId>" }` | flow only: the token moves along that edge (ending on its target) or jumps to a node |
| `checkpoint` | `{ "question": string, "options": [2-6 strings], "answer": index }` | playback pauses until the learner answers; `answer` is the 0-based index of the correct option |

### Controls (optional, at most 3)

`{ "id": "aToggle", "type": "toggle", "bind": "a.value", "label": "A" }` flips a value between 0 and 1. `{ "id": "speed", "type": "slider", "bind": "ball.x", "label": "Position", "min": -3, "max": 3, "step": 0.5 }` drives a number. `bind` uses the same `<objectId>.<prop>` form as `set`.

## Presets: prefer one when it fits

A preset expands a few params into a complete, correct demo. When the topic is one of these, reply with a preset spec instead of building objects by hand: ten lines, and always correct.

```json
{"version":1,"kind":"preset","preset":"logic-circuit","params":{"circuit":"full-adder"},"title":"Full adder","objects":[],"steps":[],"controls":[]}
```

| Preset | Teaches | Params (all optional; defaults in brackets) |
|---|---|---|
| `bit-register` | binary counting, place values, two's complement, bytes | `bits` 1-16 [8]; `mode` `"counting"` / `"twos-complement"` / `"byte-groups"` / `"powers-of-two"` [counting]; `values` up to 16 integers shown in order, each must fit the bits (signed in twos-complement mode, unsigned otherwise) |
| `logic-circuit` | gates and their truth tables, adders, mux, latch | `circuit` one of `"not"`, `"and"`, `"or"`, `"xor"`, `"nand"`, `"half-adder"`, `"full-adder"`, `"2-to-1-mux"`, `"sr-latch"` [half-adder] |
| `memory-grid` | memory cells, addresses, pointers, the stack and stack frames | `cells` 8-64 [16]; `wordSize` 1, 2, 4 or 8 [4]; `base` address of cell 0, 0-65535 [256]; `ops` up to 24 of `{"op":"store","cell":n,"value":v,"name":"x"}`, `{"op":"load","cell":n,"deref":true}`, `{"op":"pointer","cell":n,"to":m,"name":"p"}`, `{"op":"push","value":v,"name":"x"}`, `{"op":"pop"}`, `{"op":"frame","name":"main","locals":["a","b"]}`, `{"op":"return"}`; cell numbers below `cells`, names at most 8 characters, values integers or strings of at most 6 characters |
| `data-structure` | array, linked list, stack, queue, binary search tree, hash table operations | `structure` one of `"array"`, `"linked-list"`, `"stack"`, `"queue"`, `"binary-tree"`, `"hash-table"` [linked-list]; `values` up to 12 starting items; `ops` up to 16 of `{"op":"insert","value":v,"index":i}`, `{"op":"delete","value":v}`, `{"op":"search","value":v}`, `{"op":"traverse","order":"inorder"}` (order: inorder, preorder, postorder, level); `buckets` 2-11 [7], hash table only |

Use only these preset names and only the params listed. When no preset fits the concept, build the demo yourself.

## Teaching rules

- 4 to 10 steps. One idea per step: each step changes one thing the learner can see.
- Captions explain WHY, not just what: "The XOR gate sees exactly one 1, so the sum is 1", not "Set A to 1". At most about 15 words.
- The first step shows a calm starting state the learner can already explore.
- Put exactly one `checkpoint` step in the last third: a question whose answer the learner can predict from what they just watched. It is a step of its own (it may also `highlight`).
- Give every important object an `ask`: one sentence that explains the object if the learner clicks it.
- Labels are short (one to four words). Values on cells and nodes are short too.
- Write every caption, label, ask and question in the lesson's language.
- Never invent facts the lesson does not support; numbers you show must be correct.
