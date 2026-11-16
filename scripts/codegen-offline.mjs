// Offline stand-in for `npx convex codegen`, which needs a reachable Convex
// deployment for apps with components. Regenerates convex/_generated from the
// modules in convex/. Usage: node scripts/codegen-offline.mjs
//
// Keep COMPONENTS and ENV_VARS in sync with convex/convex.config.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Mounted components: name -> package path of its generated ComponentApi. */
const COMPONENTS = {
  auth: "@convex-dev/auth/_generated/component.js",
  authGoogle: "@convex-dev/auth/components/google/_generated/component.js",
};
/** Env vars declared in defineApp({ env }). */
const ENV_VARS = ["AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"];
const t = (p) => import(path.join(root, "node_modules/convex/dist/esm/cli/codegen_templates", p));
const { apiCodegen } = await t("api.js");
const { serverCodegen } = await t("server.js");
const conv = path.join(root, "convex");
const mods = fs.readdirSync(conv, { recursive: true })
  .filter((f) => /\.ts$/.test(f) && !f.startsWith("_generated") && path.basename(f).split(".").length === 2
    && !["schema.ts", "convex.config.ts", "auth.config.ts"].includes(f) && !f.includes("tsconfig"))
  .map((f) => f.replace(/\.ts$/, "").split(path.sep).join("/")).sort();
const out = path.join(conv, "_generated"); fs.mkdirSync(out, { recursive: true });
const api = apiCodegen(mods);
const comps = `
export declare const components: {
${Object.entries(COMPONENTS).map(([n, p]) => `  ${n}: import("${p}").ComponentApi<"${n}">;`).join("\n")}
};
`;
fs.writeFileSync(path.join(out, "api.d.ts"), api.DTS + comps);
fs.writeFileSync(path.join(out, "api.js"), api.JS.replace('import { anyApi } from "convex/server";', 'import { anyApi, componentsGeneric } from "convex/server";') + "\nexport const components = componentsGeneric();\n");
const envVars = ENV_VARS.map((n) => [n, { type: "value", value: '{"type":"string"}' }]);
const s = serverCodegen({ useTypeScript: false, envVars });
fs.writeFileSync(path.join(out, "server.d.ts"), s.DTS);
fs.writeFileSync(path.join(out, "server.js"), s.JS);
const src = fs.readFileSync(path.join(root, "node_modules/convex/dist/esm/cli/codegen_templates/dataModel.js"), "utf8");
const m = src.match(/const dynamicDataModelContent = `([\s\S]*?)`;\n/);
const { header } = await t("common.js");
fs.writeFileSync(path.join(out, "dataModel.d.ts"), m[1].replace("${header(\"Generated data model types.\")}", header("Generated data model types.")).replace(/\\`/g, "`"));
console.log("modules:", mods.join(", "));
