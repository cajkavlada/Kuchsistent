# Kuchsistent

A household cooking assistant: turns photographed (mostly Czech) cookbook recipes into a meal plan and a freshness-aware shopping list.

## Language

### Recipes

**Recipe**:
A dish the household cooks, captured from a cookbook photo and confirmed by a person. Only main meals and specials; no small dishes.
_Avoid_: Dish, meal (a meal is a planned occurrence, not the recipe)

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

**Meal Slot**:
A Lunch or Dinner position on a specific day.
_Avoid_: Time slot, calendar slot

**Planned Meal**:
A Recipe scheduled to be cooked once, in a Meal Slot, for a number of portions.
_Avoid_: Scheduled recipe, event

**Leftover Portion**:
A later Meal Slot covered by an earlier Planned Meal's surplus rather than by fresh cooking; optional per Planned Meal.
_Avoid_: Reheat, second serving

**Special**:
A Recipe planned for an occasion on a date (e.g. a birthday cake), in addition to that day's Lunch and Dinner rather than replacing them.
_Avoid_: Occasion meal, extra slot

**Portions**:
How many people a Planned Meal feeds; defaults to the Household size and scales the Recipe's amounts.
_Avoid_: Servings (except when quoting the book)

### Shopping

**Shopping Trip**:
A dated purchase run that a set of Shopping Items is assigned to; either an in-store trip or a Rohlík delivery.
_Avoid_: Shop, errand

**Usual Shopping Days**:
The weekdays the Household normally shops on; Shopping Trips are proposed on these days first.

**Freshness Class**:
How long an Ingredient stays good after purchase (e.g. fresh meat, vegetables, long-life); limits how early it may be bought before its Planned Meal.
_Avoid_: Shelf life, expiry

**Shopping Item**:
An Ingredient and an aggregated amount to buy on a specific Shopping Trip.
_Avoid_: List entry

**Plenty**:
A standing mark on an Ingredient meaning "we have enough at home"; it moves the Ingredient to a "we have plenty" section at the bottom of the shopping list until someone marks it running low.
_Avoid_: Staple, pantry, in stock
