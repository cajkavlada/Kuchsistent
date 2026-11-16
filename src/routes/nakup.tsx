import { createFileRoute } from "@tanstack/react-router";
import { ShoppingList } from "~/components/shopping/ShoppingList";

export const Route = createFileRoute("/nakup")({
  component: ShoppingList,
});
