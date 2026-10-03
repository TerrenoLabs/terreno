import type {SimpleCardButton} from "@terreno/blocks";

import type {ButtonProps} from "../Common";

/** The Button variant for each simple-card button style, so every card draws a style the same way. */
export const SIMPLE_CARD_BUTTON_VARIANTS: Record<
  SimpleCardButton["style"],
  NonNullable<ButtonProps["variant"]>
> = {
  cancel: "ghost",
  default: "outline",
  destructive: "destructive",
  primary: "primary",
};
