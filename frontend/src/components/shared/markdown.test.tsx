import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Markdown from './markdown';

const tableMarkdown = [
    '| Name | Email | Token |',
    '| --- | --- | --- |',
    '| sample | sample@example.com | TOKEN{0000000000000000000000000000000000000000000000000000000000000000} |',
].join('\n');

describe('Markdown', () => {
    it('wraps a table in a horizontally scrollable container so wide content cannot widen the message list', () => {
        const { container } = render(<Markdown>{tableMarkdown}</Markdown>);

        const table = container.querySelector('table');
        expect(table).not.toBeNull();
        expect(table?.parentElement?.className).toContain('overflow-x-auto');
    });

    it('keeps the table wrapped when search highlighting is active', () => {
        const { container } = render(<Markdown searchValue="sample">{tableMarkdown}</Markdown>);

        const table = container.querySelector('table');
        expect(table?.parentElement?.className).toContain('overflow-x-auto');
    });

    it('makes a code block focusable, with and without search highlighting', () => {
        // A long block scrolls; without a tab stop its content is unreachable by
        // keyboard (axe `scrollable-region-focusable`).
        for (const searchValue of [undefined, 'echo']) {
            const { container, unmount } = render(
                <Markdown searchValue={searchValue}>{'```sh\necho hello\n```'}</Markdown>,
            );

            const pre = container.querySelector('pre');
            expect(pre, `pre missing for searchValue=${searchValue}`).not.toBeNull();
            expect(pre?.getAttribute('tabindex')).toBe('0');
            unmount();
        }
    });
});
