import {
  createChange,
  createMove,
  createViewport,
  css,
  definePrimitive,
  live,
  type MoveDraft,
  type MovePoint,
} from "@ui-sdk/core";

type CanvasOptions = {
  positions: Record<string, MovePoint>;
  onPositionsChange: (positions: Record<string, MovePoint>) => void;
};

// Keep the beta SDK boundary here; workflow semantics live in the API contract.
export const workflowCanvas = definePrimitive({
  name: "workflow-canvas",
  options: { positions: "value", onPositionsChange: "callback" },
  controlled: ["positions"],
  state: (options: CanvasOptions) => ({
    positions: options.positions,
    moving: null as MoveDraft | null,
    viewport: { x: 0, y: 0, zoom: 0.8 },
  }),
  sync: (options) => ({ positions: options.positions }),
  live: ["viewport", "moving"],
  api: (context) => {
    const change = createChange(context);
    const viewport = createViewport(context, {
      key: "viewport",
      surface: () => context.element("root"),
      minZoom: () => 0.25,
      maxZoom: () => 2,
    });
    const move = createMove(context, {
      key: "positions",
      draft: "moving",
      set: (value, details) => change("positions", value, details),
      scale: () => context.store.get().viewport.zoom,
      step: () => 10,
      bounds: () => ({ minX: -10000, minY: -10000, maxX: 10000, maxY: 10000 }),
    });
    return { viewport, move };
  },
  slots: (slot) => ({
    root: slot({
      attrs: () => ({ tabindex: "0", style: css({ overflow: "clip", "touch-action": "none" }) }),
      on: {
        wheel: (event, { api }) => api.viewport.wheel(event),
        pointerdown: (event, { el, api }) => {
          if (event.target === el) api.viewport.pointerdown(event);
        },
        keydown: (event, { el, api }) => {
          if (event.target === el) api.viewport.keydown(event);
        },
      },
    }),
    world: slot({
      live: live((state, { api }) => ({ style: api.viewport.style(state) })),
    }),
    node: slot<{ value: string }>({
      props: { value: "string" },
      attrs: (state, { key }) => ({
        type: "button",
        style: css({
          position: "absolute",
          left: `${state.positions[key]?.x ?? 0}px`,
          top: `${state.positions[key]?.y ?? 0}px`,
          "touch-action": "none",
        }),
      }),
      live: live((state, { api, key }) => ({ style: api.move.style(state, key) })),
      on: {
        keydown: (event, { api, key }) => api.move.keydown(event, key),
        pointerdown: (event, { el, api, key }) => {
          if (el) api.move.pointerdown(event, key, el);
        },
        focus: (_event, { el, api }) => {
          if (el) api.viewport.reveal(api.viewport.rectOf(el), { padding: 24 });
        },
      },
    }),
    reset: slot({
      attrs: () => ({ type: "button" }),
      press: ({ api }) => api.viewport.setViewport({ x: 0, y: 0, zoom: 0.8 }),
    }),
  }),
});
