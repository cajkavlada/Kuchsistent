import { Navigate, createFileRoute } from "@tanstack/react-router";

/**
 * Invite link target. The Gate has already parked the code and redeemed it
 * (or shown why it can't be); landing here afterwards just goes home.
 * A component redirect, not `beforeLoad`, so the Gate sees the URL first.
 */
export const Route = createFileRoute("/pozvanka/$code")({
  component: () => <Navigate to="/plan" replace />,
});
