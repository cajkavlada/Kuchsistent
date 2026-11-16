/* eslint-disable */
  /**
   * Generated `api` utility.
   *
   * THIS CODE IS AUTOMATICALLY GENERATED.
   *
   * To regenerate, run `npx convex dev`.
   * @module
   */
  
  import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
  import type * as auth from "../auth.js";
import type * as extractNode from "../extractNode.js";
import type * as households from "../households.js";
import type * as ingredients from "../ingredients.js";
import type * as invites from "../invites.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_extraction from "../lib/extraction.js";
import type * as lib_ingredients from "../lib/ingredients.js";
import type * as lib_inviteCode from "../lib/inviteCode.js";
import type * as lib_matching from "../lib/matching.js";
import type * as lib_membership from "../lib/membership.js";
import type * as lib_sampleData from "../lib/sampleData.js";
import type * as lib_testMode from "../lib/testMode.js";
import type * as plan from "../plan.js";
import type * as recipes from "../recipes.js";
import type * as seed from "../seed.js";
import type * as testLogin from "../testLogin.js";
import type * as users from "../users.js";

  /**
   * A utility for referencing Convex functions in your app's API.
   *
   * Usage:
   * ```js
   * const myFunctionReference = api.myModule.myFunction;
   * ```
   */
  declare const fullApi: ApiFromModules<{
    "auth": typeof auth,
"extractNode": typeof extractNode,
"households": typeof households,
"ingredients": typeof ingredients,
"invites": typeof invites,
"lib/config": typeof lib_config,
"lib/dates": typeof lib_dates,
"lib/extraction": typeof lib_extraction,
"lib/ingredients": typeof lib_ingredients,
"lib/inviteCode": typeof lib_inviteCode,
"lib/matching": typeof lib_matching,
"lib/membership": typeof lib_membership,
"lib/sampleData": typeof lib_sampleData,
"lib/testMode": typeof lib_testMode,
"plan": typeof plan,
"recipes": typeof recipes,
"seed": typeof seed,
"testLogin": typeof testLogin,
"users": typeof users,
  }>;
  export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
  export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
  
export declare const components: {
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authGoogle: import("@convex-dev/auth/components/google/_generated/component.js").ComponentApi<"authGoogle">;
  authPassword: import("@convex-dev/auth/components/password/_generated/component.js").ComponentApi<"authPassword">;
  authUsername: import("@convex-dev/auth/components/username/_generated/component.js").ComponentApi<"authUsername">;
};
