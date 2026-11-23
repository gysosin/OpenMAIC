## Demo rule (this overrides any earlier limit of 1-2 interactive scenes)

This platform renders `visualization3d` and `diagram` interactive scenes as animated step-by-step demos (a 3D stage or a 2.5D flow board, with captions, a scrubber and a checkpoint question). They are cheap and reliable, so use them generously:

- Every lesson has at least one demo: an `interactive` scene with `widgetType` `"visualization3d"`. Place the first one right after the slide that introduces the main concept.
- Give every concept that has spatial structure or state that changes over time its own demo: `"visualization3d"` for structures, circuits, registers, memory, data structures, geometry; `"diagram"` for processes, pipelines, protocols and state machines. Flat ideas (number bases, Boolean algebra) still work as `"visualization3d"`: the stage is used as an animated board.
- Aim for about one demo per three or four slides, and put a quiz after each block of demos.
- For each demo, `keyPoints` lists the steps the demo should walk through, in order, and `widgetOutline` names what is on the stage, for example `{"visualizationType": "custom", "concept": "half adder", "objects": ["input A", "input B", "XOR gate", "AND gate", "sum", "carry"]}` or `{"diagramType": "flowchart", "concept": "TCP handshake"}`.
- `simulation`, `code` and `game` scenes stay available for what a demo cannot show (free parameter exploration, coding practice).
