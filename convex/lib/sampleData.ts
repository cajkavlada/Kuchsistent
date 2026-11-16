import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Sample confirmed Recipes for preview backends. `seed:preview` runs before
 * any tester exists, so the data is added when a test user founds a Household
 * (`createHouseholdFor`, test mode only). Production never runs this.
 */
type Sample = {
  name: string;
  category: "main" | "special";
  baseServings?: number;
  lines: string[];
  steps: string[];
};

const SAMPLES: Sample[] = [
  {
    name: "Svíčková na smetaně",
    category: "main",
    baseServings: 4,
    lines: ["800 g hovězí zadní", "2 mrkve", "1 petržel", "1/4 celeru", "1 cibule", "250 ml smetany ke šlehání"],
    steps: ["Maso prošpikuj a opeč.", "Přidej zeleninu, podlij a duš do měkka.", "Omáčku rozmixuj a zjemni smetanou."],
  },
  {
    name: "Guláš s knedlíkem",
    category: "main",
    baseServings: 4,
    lines: ["600 g hovězí kližky", "3 cibule", "2 lžíce sladké papriky", "1 lžička kmínu"],
    steps: ["Cibuli osmahni dozlatova.", "Přidej maso a papriku, podlij a duš 2 hodiny."],
  },
  {
    name: "Kuře na paprice",
    category: "main",
    baseServings: 4,
    lines: ["1 kuře", "1 cibule", "1 lžíce sladké papriky", "200 ml zakysané smetany"],
    steps: ["Kuře porcuj a opeč.", "Duš s cibulí a paprikou, zahusti smetanou."],
  },
  {
    name: "Smažený sýr s bramborem",
    category: "main",
    baseServings: 2,
    lines: ["300 g eidamu", "2 vejce", "hladká mouka", "strouhanka", "500 g brambor"],
    steps: ["Sýr obal v mouce, vejci a strouhance.", "Smaž dozlatova, podávej s vařeným bramborem."],
  },
  {
    name: "Špagety boloňské",
    category: "main",
    baseServings: 4,
    lines: ["400 g špaget", "500 g mletého hovězího", "1 plechovka rajčat", "1 cibule"],
    steps: ["Maso opeč s cibulí.", "Přidej rajčata a duš 30 minut.", "Uvař špagety a smíchej."],
  },
  {
    name: "Čočka na kyselo",
    category: "main",
    baseServings: 4,
    lines: ["300 g čočky", "1 cibule", "2 lžíce octa", "4 vejce"],
    steps: ["Čočku uvař do měkka.", "Zahusti jíškou, okyselí octem.", "Podávej s volským okem."],
  },
  {
    name: "Narozeninový dort",
    category: "special",
    baseServings: 12,
    lines: ["6 vajec", "180 g cukru", "150 g hladké mouky", "500 g mascarpone"],
    steps: ["Upeč piškot.", "Rozkrojuj, prolij a naplň krémem."],
  },
  {
    name: "Medovník",
    category: "special",
    lines: ["3 lžíce medu", "500 g hladké mouky", "2 vejce", "1 l mléka"],
    steps: ["Upeč pláty.", "Prolož krémem a nech den odležet."],
  },
];

export async function addSampleRecipes(
  ctx: MutationCtx,
  household: Id<"households">,
): Promise<void> {
  for (const s of SAMPLES) {
    const recipe = await ctx.db.insert("recipes", {
      household,
      name: s.name,
      category: s.category,
      status: "confirmed",
      archived: false,
      baseServings: s.baseServings,
      steps: s.steps,
    });
    for (const [order, raw] of s.lines.entries()) {
      await ctx.db.insert("ingredientLines", { recipe, order, raw });
    }
  }
}
