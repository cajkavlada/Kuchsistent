import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "~/components/AppLayout";

export const Route = createFileRoute("/recepty")({
  component: () => <Placeholder title="Recepty" text="Zatím tu nejsou žádné recepty." />,
});
