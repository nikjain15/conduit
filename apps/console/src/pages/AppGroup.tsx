/**
 * Shared app-grouping primitives.
 *
 * Every console tab groups its use cases under the app they belong to, so the
 * reader always sees which product a card or row is for. `AppHeading` renders
 * the app section header; `UseCaseTag` renders the "app / useCase" label that
 * sits on each per-use-case card; `groupByApp` buckets an arbitrary list by the
 * app of its use case, in the fleet's app order.
 */
import type { ReactNode } from "react";
import { APPS, appLabelOf, appOfUseCase } from "../data/sample.ts";

/** The "app / useCase" tag shown on each per-use-case card. */
export function UseCaseTag({ app, useCase }: { app: string; useCase: string }) {
  return (
    <span className="uc-tag">
      <span className="uc-tag-app">{appLabelOf(app)}</span>
      <span className="uc-tag-sep">/</span>
      <span>{useCase}</span>
    </span>
  );
}

/** An app section header with the app label and a use case count. */
export function AppHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="app-heading">
      <h3>{label}</h3>
      <span className="app-count">
        {count} use {count === 1 ? "case" : "cases"}
      </span>
    </div>
  );
}

/**
 * Group items by the app of their use case, in APPS order. `getUseCaseId`
 * extracts the use case id from each item. Apps with no items are dropped.
 */
export function groupByApp<T>(
  items: T[],
  getUseCaseId: (item: T) => string,
): Array<{ app: string; label: string; items: T[] }> {
  return APPS.map((app) => ({
    app: app.id,
    label: app.label,
    items: items.filter((it) => appOfUseCase(getUseCaseId(it)) === app.id),
  })).filter((g) => g.items.length > 0);
}

/** Render app-grouped sections given a per-item renderer. Each section shows the
 *  app heading followed by the items wrapped by `wrap` (for example in a grid). */
export function AppSections<T>({
  items,
  getUseCaseId,
  renderItem,
  wrap,
}: {
  items: T[];
  getUseCaseId: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  wrap?: (children: ReactNode) => ReactNode;
}) {
  const groups = groupByApp(items, getUseCaseId);
  return (
    <>
      {groups.map((g) => {
        const cards = g.items.map((it) => renderItem(it));
        return (
          <div className="app-group" key={g.app}>
            <AppHeading label={g.label} count={g.items.length} />
            {wrap ? wrap(cards) : cards}
          </div>
        );
      })}
    </>
  );
}
