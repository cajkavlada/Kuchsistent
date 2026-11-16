# Kuchsistent

A household cooking assistant: turns photographed (mostly Czech) cookbook recipes into a meal plan and a freshness-aware shopping list.

## Language

### Recipes

**Recipe**:
A dish the household cooks, captured from a cookbook photo and confirmed by a person. Only main meals and specials; no small dishes.
_Avoid_: Dish, meal (a meal is a planned occurrence, not the recipe)

**Draft Recipe**:
A Recipe still being extracted or awaiting the user's review; it can't be planned until confirmed.
_Avoid_: Pending recipe, unconfirmed

**Archived Recipe**:
A Recipe removed from the library and picker that still backs any meals already planned with it.
_Avoid_: Deleted recipe

**Recipe Category**:
Whether a Recipe is a main (lunch/dinner) or a special; it filters the picker but doesn't restrict where the Recipe can be planned.

**Recipe Photo**:
The original picture of a cookbook page that a Recipe was extracted from; kept with the Recipe.
_Avoid_: Scan, image

**Ingredient Line**:
One line of a Recipe's ingredient list: an ingredient, an amount and a unit, as written in the book.
_Avoid_: Item

**Ingredient**:
The canonical thing you buy (e.g. "cibule"), shared across Recipes, carrying a Freshness Class and a Store Section.
_Avoid_: Product, grocery

### Planning

**Household**:
The group of people (the user and his wife) who share one plan and one shopping list.
_Avoid_: Family, account, team

**Member**:
A person who belongs to a Household; every Member is equal and sees the same plan, list and recipes. A person belongs to exactly one Household.
_Avoid_: User (when meaning a Household's person), owner, admin

**Invite**:
A single-use, time-limited link (with a short code) a Member creates so another person can join their Household.
_Avoid_: Invitation code, share link

**Meal Slot**:
A Lunch, Dinner or Special position on a specific day; usually holds one item but may hold several.
_Avoid_: Time slot, calendar slot

**Planned Meal**:
A Recipe scheduled to be cooked once, in a Meal Slot, for a number of portions.
_Avoid_: Scheduled recipe, event

**Leftover Portion**:
A later Meal Slot covered by an earlier Planned Meal's surplus rather than by fresh cooking; optional per Planned Meal.
_Avoid_: Reheat, second serving

**Special**:
A Planned Meal for an Occasion on a date (e.g. a birthday cake), in addition to that day's Lunch and Dinner; a day may have several.

**Occasion**:
The free-text reason for a Special (e.g. "Ondra – narozeniny").
_Avoid_: Occasion meal, extra slot

**Portions**:
How many people a Planned Meal feeds; defaults to the Household size and scales the Recipe's amounts.
_Avoid_: Servings (except when quoting the book)

### Shopping

**Shopping Trip**:
A dated purchase run that a set of Shopping Items is assigned to; created by default at a regular interval and freely moved, removed or added; either an in-store trip or a Rohlík delivery.
_Avoid_: Shop, errand

**Freshness Class**:
How long an Ingredient stays good after purchase (e.g. fresh meat, vegetables, long-life); buying earlier than that before its Planned Meal is flagged as not fresh.
_Avoid_: Shelf life, expiry

**Shopping Item**:
An Ingredient and an aggregated amount to buy on a specific Shopping Trip, generated from the Planned Meals that need it.
_Avoid_: List entry

**Manual Shopping Item**:
A Shopping Item the user added directly (e.g. toilet paper), not tied to any meal and never changed by regeneration.

**Never Buy**:
A mark on an Ingredient that is never purchased (e.g. water); it never appears on the shopping list.
_Avoid_: Excluded, ignored

**Optional Line**:
An Ingredient Line the recipe treats as optional ("případně", "na ozdobu"); listed with a "volitelné" note.

**Measure Kind**:
How an Ingredient is counted on the list: by weight, by volume or by pieces.
_Avoid_: Unit type

**Store Section**:
The supermarket area an Ingredient is found in; groups the shopping list in walking order.
_Avoid_: Category, aisle

**Plenty**:
A standing mark on an Ingredient meaning "we have enough at home"; it moves the Ingredient to a "we have plenty" section at the bottom of the shopping list until someone marks it running low.
_Avoid_: Staple, pantry, in stock
