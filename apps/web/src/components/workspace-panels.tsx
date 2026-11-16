"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  createResizableController,
  Resizable,
  ResizableHandle,
  ResizablePanel,
} from "@ui-sdk/react/resizable";
import { useOwner } from "@/components/access-context";
import { ownerStoragePrefix } from "@/lib/access";

const narrowQuery = "(max-width: 850px)";
function subscribeNarrow(callback: () => void) {
  const query = window.matchMedia(narrowQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const isNarrow = () => window.matchMedia(narrowQuery).matches;

export function WorkspacePanels({
  library,
  canvas,
  inspector,
  libraryOpen,
  inspectorOpen,
  onLibraryOpen,
  onInspectorOpen,
  onSeal,
}: {
  library: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  libraryOpen: boolean;
  inspectorOpen: boolean;
  onLibraryOpen: (value: boolean) => void;
  onInspectorOpen: (value: boolean) => void;
  onSeal?: () => void;
}) {
  const { owner } = useOwner();
  const [panels] = useState(createResizableController);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  useEffect(() => {
    if (narrow) return;
    if (libraryOpen === panels.isCollapsed("workspace-steps")) {
      if (libraryOpen) panels.expand("workspace-steps");
      else panels.collapse("workspace-steps");
    }
    if (inspectorOpen === panels.isCollapsed("workspace-details")) {
      if (inspectorOpen) panels.expand("workspace-details");
      else panels.collapse("workspace-details");
    }
  }, [libraryOpen, inspectorOpen, narrow, panels]);

  // Small screens use document flow, with the canvas first. Desktop preferences
  // stay in their own persisted SDK layout and never enter the workflow document.
  if (narrow) {
    return (
      <div className="editor-grid compact" onBlurCapture={onSeal}>
        {canvas}
        {libraryOpen && library}
        {inspectorOpen && inspector}
      </div>
    );
  }
  return (
    <Resizable
      className="editor-grid"
      controller={panels}
      autoSaveId={ownerStoragePrefix(owner) + ".editor-panels.v1"}
      onBlurCapture={onSeal}
      onLayoutChange={(layout) => {
        if (layout.length !== 3) return;
        onLibraryOpen(layout[0]! > 0);
        onInspectorOpen(layout[2]! > 0);
      }}
    >
      <ResizablePanel
        id="workspace-steps"
        className="workspace-panel"
        defaultSize="232px"
        minSize="200px"
        maxSize="400px"
        collapsible
      >
        {library}
      </ResizablePanel>
      <ResizableHandle className="panel-resize-handle" aria-label="Resize steps panel" />
      <ResizablePanel id="workspace-canvas" className="workspace-panel" minSize="320px">
        {canvas}
      </ResizablePanel>
      <ResizableHandle className="panel-resize-handle" aria-label="Resize details panel" />
      <ResizablePanel
        id="workspace-details"
        className="workspace-panel"
        defaultSize="300px"
        minSize="260px"
        maxSize="480px"
        collapsible
      >
        {inspector}
      </ResizablePanel>
    </Resizable>
  );
}
