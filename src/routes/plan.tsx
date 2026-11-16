import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "~/components/AppLayout";

export const Route = createFileRoute("/plan")({
  component: () => <Placeholder title="Plán" text="Tady bude plán jídel." />,
});
