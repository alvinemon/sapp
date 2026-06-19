import type { ReactNode } from "react";

interface ContentRowProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function ContentRow({ title, children, action }: ContentRowProps) {
  return (
    <section className="nf-row">
      <div className="nf-row-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="nf-row-scroll">{children}</div>
    </section>
  );
}
