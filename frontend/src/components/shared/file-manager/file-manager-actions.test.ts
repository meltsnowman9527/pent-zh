import { describe, expect, it } from 'vitest';

import { uiText } from '@/locales/zh-CN';

import { bulkCopyAction, bulkMoveAction } from './file-manager-actions';

/**
 * The built-in bulk actions' default labels are rendered as menu items, so they must
 * come from the copy table; they used to default to the English `Move to…` / `Copy to…`.
 */
describe('file-manager bulk action labels', () => {
    it('defaults to localized labels', () => {
        expect(bulkMoveAction(() => {}).label).toBe(uiText('Move to…'));
        expect(bulkCopyAction(() => {}).label).toBe(uiText('Copy to…'));
    });

    it('still lets a host override the label', () => {
        expect(bulkMoveAction(() => {}, { label: 'Move here' }).label).toBe('Move here');
    });
});
