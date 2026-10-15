import type { Page } from '@playwright/test';

import { uiText } from '@/locales/zh-CN';

// The markdown editor is a ProseMirror contenteditable: fill() mutates the DOM directly and
// races the observer flush against the next action (e.g. a submit click), so the typed content
// can fail to land in the model. Real key events apply synchronously — always type through this.
// `name` is a copy-table key because the editor is addressed by its localized aria-label.
export const typeIntoEditor = async (
    page: Page,
    name: Parameters<typeof uiText>[0],
    text: string,
): Promise<void> => {
    const editor = page.getByRole('textbox', { name: uiText(name) });

    await editor.click();
    await editor.pressSequentially(text);
};
