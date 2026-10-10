/**
 * Prompts for the example app's generated photo library (`bun run photos:generate`). Each entry
 * becomes one `PhotoLibraryEntry`, keyed by `prompt`: editing a prompt makes a new photo, while
 * editing only `alt` or `tags` takes effect on the next `--force` run.
 */
export interface PhotoPrompt {
  /** Alt text, 1–200 characters. */
  alt: string;
  /** The image-model prompt, also the upsert key. */
  prompt: string;
  /** Search tags for `findPhotos`, 1–12. */
  tags: string[];
}

const STYLE = "Natural window light, shallow depth of field, editorial food photography, no text";

export const PHOTO_PROMPTS: PhotoPrompt[] = [
  {
    alt: "A rosemary and garlic roast leg of lamb, carved, on a wooden board",
    prompt: `A roast leg of lamb studded with rosemary and garlic, partly carved on a wooden board. ${STYLE}`,
    tags: ["roast", "lamb", "main", "sunday roast", "meat"],
  },
  {
    alt: "Golden crispy roast potatoes in a dark roasting tin",
    prompt: `Golden, crispy roast potatoes with fluffy edges in a dark roasting tin. ${STYLE}`,
    tags: ["potatoes", "roast potatoes", "side", "sunday roast", "vegetarian"],
  },
  {
    alt: "Honey-glazed roast carrots and parsnips with thyme",
    prompt: `Honey-glazed roast carrots and parsnips scattered with thyme on a platter. ${STYLE}`,
    tags: ["carrots", "parsnips", "vegetables", "side", "honey", "vegetarian"],
  },
  {
    alt: "Lemony sautéed greens with garlic in a white bowl",
    prompt: `Lemony sautéed spring greens and kale with garlic in a white bowl. ${STYLE}`,
    tags: ["greens", "kale", "vegetables", "side", "lemon", "vegan"],
  },
  {
    alt: "Apple crumble with a golden oat topping and a jug of custard",
    prompt: `A baked apple crumble with a golden oat topping beside a jug of custard. ${STYLE}`,
    tags: ["apple crumble", "crumble", "dessert", "pudding", "apple"],
  },
  {
    alt: "A laid table for a Sunday roast with plates, glasses and candles",
    prompt: `A laid dining table for a Sunday roast for six: plates, glasses, napkins, candles. ${STYLE}`,
    tags: ["table", "table setting", "dinner", "sunday roast", "hosting"],
  },
  {
    alt: "Rich gravy being poured from a gravy boat",
    prompt: `Rich brown gravy being poured from a white gravy boat. ${STYLE}`,
    tags: ["gravy", "sauce", "sunday roast"],
  },
  {
    alt: "Tall, puffed Yorkshire puddings in a muffin tin",
    prompt: `Tall, puffed golden Yorkshire puddings in a muffin tin. ${STYLE}`,
    tags: ["yorkshire puddings", "side", "sunday roast", "vegetarian"],
  },
  {
    alt: "Mint sauce in a small glass jar with fresh mint leaves",
    prompt: `Homemade mint sauce in a small glass jar with fresh mint leaves beside it. ${STYLE}`,
    tags: ["mint sauce", "sauce", "lamb", "condiment", "vegan"],
  },
  {
    alt: "Cauliflower cheese with a browned, bubbling top in a baking dish",
    prompt: `Cauliflower cheese with a browned, bubbling top in a ceramic baking dish. ${STYLE}`,
    tags: ["cauliflower cheese", "cauliflower", "side", "cheese", "vegetarian"],
  },
  {
    alt: "Raw ingredients for a roast laid out on a kitchen counter",
    prompt: `Raw ingredients for a Sunday roast on a kitchen counter: lamb, potatoes, carrots, parsnips, herbs. ${STYLE}`,
    tags: ["ingredients", "shopping", "prep", "sunday roast"],
  },
  {
    alt: "A plated Sunday roast with lamb, potatoes, vegetables and gravy",
    prompt: `A single plated Sunday roast: sliced lamb, roast potatoes, carrots, greens, gravy. ${STYLE}`,
    tags: ["plate", "sunday roast", "lamb", "dinner", "main"],
  },
];
