import { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-neutral-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}

export function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-neutral-800 mb-1">{title}</h3>
      {children}
    </div>
  );
}
