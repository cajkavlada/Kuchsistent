import { createFileRoute } from "@tanstack/react-router";
import { isCalendarDay, today } from "@convex/lib/dates";
import { DayPlan } from "~/components/plan/DayPlan";

type PlanSearch = {
  /** Selected day, `YYYY-MM-DD`; today when unset. */
  den?: string;
  /** "Naplánovat" from a Recipe: open the picker with this Recipe. */
  naplanovat?: string;
};

export const Route = createFileRoute("/plan")({
  // Never redirect here: OAuth returns to /plan with `?code=` (see AGENTS.md).
  validateSearch: (search: Record<string, unknown>): PlanSearch => ({
    den: typeof search.den === "string" && isCalendarDay(search.den) ? search.den : undefined,
    naplanovat: typeof search.naplanovat === "string" ? search.naplanovat : undefined,
  }),
  component: PlanScreen,
});

function PlanScreen() {
  const { den, naplanovat } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DayPlan
      day={den ?? today()}
      planRecipe={naplanovat}
      onChange={({ day, planRecipeDone }) =>
        void navigate({
          search: (s) => ({
            ...s,
            ...(day !== undefined && { den: day === today() ? undefined : day }),
            ...(planRecipeDone && { naplanovat: undefined }),
          }),
          replace: true,
        })
      }
    />
  );
}
