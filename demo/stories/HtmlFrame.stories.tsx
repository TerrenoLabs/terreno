import {HtmlFrame} from "@terreno/ui";
import type React from "react";

const INVOICE = `<h1>Invoice #1042</h1><table><tr><td>Seats</td><td>12</td></tr></table>`;

export const HtmlFrameDemo: React.FC = () => (
  <HtmlFrame height="sm" html={INVOICE} title="Invoice preview" />
);
