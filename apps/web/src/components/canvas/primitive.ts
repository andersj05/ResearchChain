import {
  createChange,
  createConnect,
  createMove,
  createViewport,
  css,
  definePrimitive,
  live,
  type ConnectDraft,
  type MoveDraft,
  type MovePoint,
} from "@ui-sdk/core";
import { compatiblePorts, type Port } from "@/lib/workflow-editing";

export type CanvasPort = Port & { offset: MovePoint; label: string };
type CanvasOptions = {
  positions: Record<string, MovePoint>;
  sizes: Record<string, { width: number; height: number }>;
  ports: Record<string, CanvasPort>;
  onPositionsChange: (positions: Record<string, MovePoint>, details: { reason: string }) => void;
  onConnect: (from: string, to: string) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string, child?: string) => void;
};
type MovingState = { positions: Record<string, MovePoint>; moving: MoveDraft | null };

function portPoint(state: MovingState, port?: CanvasPort): MovePoint | undefined {
  if (!port) return;
  const at = state.positions[port.node];
  if (!at) return;
  const draft = state.moving?.keys.includes(port.node) ? state.moving : null;
  return { x: at.x + port.offset.x + (draft?.dx ?? 0), y: at.y + port.offset.y + (draft?.dy ?? 0) };
}
function curve(from?: MovePoint, to?: MovePoint) {
  if (!from || !to) return "";
  const bend = Math.max(55, Math.min(150, Math.abs(to.x - from.x) / 2));
  return `M${from.x},${from.y} C${from.x + bend},${from.y} ${to.x - bend},${to.y} ${to.x},${to.y}`;
}

// Only this adapter depends on UI SDK gestures. Saved documents contain no UI state.
export const workflowCanvas = definePrimitive({
  name: "workflow-canvas",
  options: {
    positions: "value",
    sizes: "value",
    ports: "value",
    onPositionsChange: "callback",
    onConnect: "callback",
    onSelect: "callback",
    onOpen: "callback",
  },
  controlled: ["positions"],
  state: (options: CanvasOptions) => ({
    positions: options.positions,
    moving: null as MoveDraft | null,
    connecting: null as ConnectDraft | null,
    viewport: { x: 24, y: 24, zoom: 1 },
  }),
  sync: (options) => ({ positions: options.positions }),
  live: ["positions", "viewport", "moving", "connecting"],
  api: (context) => {
    const change = createChange(context);
    const viewport = createViewport(context, {
      key: "viewport",
      surface: () => context.element("root"),
      minZoom: () => 0.05,
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
    const connect = createConnect(context, {
      slot: "port",
      draft: "connecting",
      point: (x, y) => viewport.toCanvas(x, y),
      canConnect: (from, to) =>
        compatiblePorts(context.options().ports[from], context.options().ports[to]),
      connect: (from, to) => {
        context.options().onConnect(from, to);
        return true;
      },
      label: (key) => context.options().ports[key]?.label ?? key,
      radius: () => 18,
    });
    function fit() {
      const boxes = Object.entries(context.store.get().positions).map(([key, at]) => ({
        ...at,
        width: context.options().sizes[key]?.width ?? 230,
        height: context.options().sizes[key]?.height ?? 160,
      }));
      if (!boxes.length) return;
      viewport.fit(
        {
          left: Math.min(...boxes.map((box) => box.x)) - 12,
          top: Math.min(...boxes.map((box) => box.y)),
          right: Math.max(...boxes.map((box) => box.x + box.width)) + 12,
          bottom: Math.max(...boxes.map((box) => box.y + box.height)),
        },
        { padding: 48, maxZoom: 1 },
      );
    }
    function reveal(el: HTMLElement | null | undefined) {
      if (el) viewport.reveal(viewport.rectOf(el), { padding: 28 });
    }
    function connectKey(event: KeyboardEvent) {
      if (!connect.keydown(event)) return false;
      const target = context.store.get().connecting?.to;
      if (target) reveal(context.element("port", target));
      return true;
    }
    return {
      viewport,
      move,
      connect,
      connectKey,
      fit,
      reveal,
      select: (id: string) => context.options().onSelect(id),
      open: (id: string, child?: string) => context.options().onOpen(id, child),
      point: (state: MovingState, key: string) => portPoint(state, context.options().ports[key]),
    };
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
          if (!api.connectKey(event) && event.target === el) api.viewport.keydown(event);
        },
      },
    }),
    world: slot({ live: live((state, { api }) => ({ style: api.viewport.style(state) })) }),
    group: slot<{ value: string }>({
      props: { value: "string" },
      attrs: (state, { key }) => ({
        style: css({
          position: "absolute",
          left: `${state.positions[key]?.x ?? 0}px`,
          top: `${state.positions[key]?.y ?? 0}px`,
        }),
      }),
      live: live((state, { api, key }) => ({
        style:
          css({
            left: `${state.positions[key]?.x ?? 0}px`,
            top: `${state.positions[key]?.y ?? 0}px`,
          }) + (api.move.style(state, key) ?? ""),
        "data-dragging": api.move.dragging(state, key) ? "" : undefined,
      })),
    }),
    node: slot<{ value: string }>({
      props: { value: "string" },
      attrs: () => ({ type: "button", style: css({ "touch-action": "none" }) }),
      press: ({ api, key }) => api.select(key),
      on: {
        keydown: (event, { api, key }) => {
          if (api.move.keydown(event, key)) event.stopPropagation();
        },
        pointerdown: (event, { el, api, key }) => {
          if (el) api.move.pointerdown(event, key, el);
        },
        focus: (_event, { el, api }) => api.reveal(el),
      },
    }),
    open: slot<{ value: string; node: string; child?: string }>({
      props: { value: "string", node: "string", child: "string" },
      attrs: () => ({ type: "button" }),
      press: ({ api, props }) => api.open(props.node, props.child),
    }),
    port: slot<{ value: string }>({
      props: { value: "string" },
      attrs: () => ({ type: "button" }),
      live: live((state, { api, key }) => ({ "data-connect": api.connect.role(state, key) })),
      on: {
        pointerdown: (event, { el, api, key }) => {
          if (el) api.connect.pointerdown(event, key, el);
        },
        keydown: (event, { api, key }) => {
          if (api.connectKey(event)) {
            event.stopPropagation();
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            api.connect.start(key);
          }
        },
        click: (event, { api, key }) => {
          if (event.detail === 0 && !api.connect.active()) api.connect.start(key);
        },
        focus: (_event, { el, api }) => api.reveal(el),
      },
    }),
    edge: slot<{ value: string }>({
      props: { value: "string" },
      live: live((state, { api, key }) => {
        const [from, to] = key.split("/");
        return {
          d: curve(api.point(state, from!), api.point(state, to!)),
        };
      }),
    }),
    draft: slot({
      live: live((state, { api }) => ({
        d: state.connecting
          ? curve(
              api.point(state, state.connecting.from),
              state.connecting.to ? api.point(state, state.connecting.to) : state.connecting,
            )
          : "",
      })),
    }),
    reset: slot({
      attrs: () => ({ type: "button" }),
      press: ({ api }) => api.viewport.setViewport({ x: 24, y: 24, zoom: 1 }),
    }),
    fit: slot({ attrs: () => ({ type: "button" }), press: ({ api }) => api.fit() }),
    zoomIn: slot({
      attrs: () => ({ type: "button" }),
      press: ({ api }) => api.viewport.zoomBy(1.25),
    }),
    zoomOut: slot({
      attrs: () => ({ type: "button" }),
      press: ({ api }) => api.viewport.zoomBy(0.8),
    }),
  }),
});
