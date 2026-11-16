import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Review } from "~/components/recipes/Review";
import { RecipeDetail, Reading, ReadingFailed, Saved } from "~/components/recipes/screens";
import { TopBar } from "~/components/recipes/ui";

export const Route = createFileRoute("/recepty/$recipeId")({
  component: RecipeScreen,
});

/**
 * One Recipe, shown by where it stands: being read, failed, awaiting review,
 * just saved, or confirmed. Opening a draft from "Rozpracované" resumes here.
 */
function RecipeScreen() {
  const { recipeId } = Route.useParams();
  const recipe = useQuery(api.recipes.get, { recipeId });
  const [justSaved, setJustSaved] = useState(false);

  if (recipe === undefined) {
    return (
      <section className="page">
        <p className="muted">Načítám…</p>
      </section>
    );
  }
  if (recipe === null || recipe.archived) {
    return (
      <section className="page">
        <TopBar title="Recept nenalezen" />
        <p className="muted">Tenhle recept už neexistuje.</p>
      </section>
    );
  }
  if (recipe.status === "confirmed") {
    return justSaved ? <Saved recipe={recipe} /> : <RecipeDetail recipe={recipe} />;
  }
  if (recipe.extraction?.state === "pending") return <Reading recipe={recipe} />;
  if (recipe.extraction?.state === "failed") return <ReadingFailed recipe={recipe} />;
  return <Review recipe={recipe} onSaved={() => setJustSaved(true)} />;
}
