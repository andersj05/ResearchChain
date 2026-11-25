import type { ExtraProps } from "react-markdown";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import { ChartImage } from "./source-chart-dialog";
import chartStyles from "./source-intake.module.css";
import styles from "./research-reader.module.css";

type Element = NonNullable<ExtraProps["node"]>;
type Content = Element["children"][number];

export function reportFigureActions() {
  function addActions(children: Content[], linkedActions?: Element[]): Content[] {
    return children.flatMap<Content>((child) => {
      if (child.type !== "element") return [child];
      if (child.tagName === "img") {
        const action: Element = {
          type: "element",
          tagName: "button",
          properties: {
            dataReportFigureSource: child.properties.src,
            dataReportFigureLabel: child.properties.alt,
          },
          children: [],
        };
        if (!linkedActions) return [child, action];
        linkedActions.push(action);
        return [child];
      }
      if (child.tagName === "a" && !linkedActions) {
        // An image can be part of a source link. Put its action after the entire link.
        const actions: Element[] = [];
        child.children = addActions(child.children, actions);
        return [child, ...actions];
      }
      child.children = addActions(child.children, linkedActions);
      return [child];
    });
  }
  return (tree: { type: string; children?: Content[] }) => {
    if (tree.type === "root" && tree.children) tree.children = addActions(tree.children);
  };
}

export function ReportFigureButton({
  src,
  title,
  filename,
}: {
  src: string;
  title: string;
  filename: string;
}) {
  return (
    <Dialog container={typeof document === "undefined" ? null : document.body}>
      <DialogTrigger
        className={`button ${styles.figureAction}`}
        aria-label={`Inspect figure: ${title}`}
      >
        Inspect figure
      </DialogTrigger>
      <DialogBackdrop className="dialog-backdrop" />
      <DialogContent
        className={`${chartStyles.chartDialog} ${styles.figureDialog}`}
        initialFocus="content"
      >
        <header>
          <div>
            <DialogTitle>{title}</DialogTitle>
            {title !== filename && <DialogDescription>{filename}</DialogDescription>}
          </div>
          <DialogClose aria-label="Close figure" className="button icon-button">
            <X size={18} aria-hidden />
          </DialogClose>
        </header>
        <ChartImage src={src} title={title} />
      </DialogContent>
    </Dialog>
  );
}
