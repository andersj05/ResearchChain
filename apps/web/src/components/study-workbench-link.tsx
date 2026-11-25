export function StudyWorkbenchLink({
  href,
  className,
  newTab,
  children,
}: {
  href: string;
  className?: string;
  newTab?: boolean;
  children: string;
}) {
  return (
    <a
      className={className}
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener" : undefined}
    >
      {children}
      {newTab && " (new tab)"}
    </a>
  );
}
