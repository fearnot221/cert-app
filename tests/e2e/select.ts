import type { Page } from "@playwright/test";

/** Picks an option in the app's own select (a WAI-ARIA combobox with a listbox popup). */
export async function choose(page: Page, name: string | RegExp, option: string | { index: number }) {
  await page.getByRole("combobox", typeof name === "string" ? { name, exact: true } : { name }).click();
  const listbox = page.getByRole("listbox");
  await (typeof option === "string"
    ? listbox.getByRole("option", { name: option, exact: true })
    : listbox.getByRole("option").nth(option.index)
  ).click();
}
