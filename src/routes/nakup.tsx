import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "~/components/AppLayout";

export const Route = createFileRoute("/nakup")({
  component: () => <Placeholder title="Nákup" text="Tady bude nákupní seznam." />,
});
