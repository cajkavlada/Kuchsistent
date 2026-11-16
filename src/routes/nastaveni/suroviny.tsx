import { createFileRoute } from "@tanstack/react-router";
import { Catalogue } from "~/components/settings/Catalogue";

export const Route = createFileRoute("/nastaveni/suroviny")({ component: Catalogue });
