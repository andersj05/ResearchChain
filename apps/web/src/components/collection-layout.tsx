"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";
import { useOwner } from "@/components/access-context";
import { ownerStoragePrefix } from "@/lib/access";

const query = "(max-width: 850px)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const narrow = () => window.matchMedia(query).matches;

export function CollectionLayout({
  id,
  list,
  detail,
}: {
  id: "sources" | "runs";
  list: ReactNode;
  detail: ReactNode;
}) {
  const { owner } = useOwner();
  const small = useSyncExternalStore(subscribe, narrow, () => false);
  return (
    <Resizable
      className={`collection-layout collection-${id}${small ? " compact" : ""}`}
      disabled={small}
      autoSaveId={`${ownerStoragePrefix(owner)}.collection.${id}.v1`}
    >
      <ResizablePanel
        className="collection-panel"
        id={`${id}-list`}
        defaultSize="310px"
        minSize="260px"
        maxSize="480px"
      >
        {list}
      </ResizablePanel>
      <ResizableHandle className="panel-resize-handle" aria-label={`Resize ${id} list`} />
      <ResizablePanel className="collection-panel" id={`${id}-detail`} minSize="420px">
        {detail}
      </ResizablePanel>
    </Resizable>
  );
}
