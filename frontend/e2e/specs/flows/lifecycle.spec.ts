import type { ResultOf } from '@graphql-typed-document-node/core';

import type {
    AddFavoriteFlowDocument,
    DeleteFlowDocument,
    FinishFlowDocument,
    RenameFlowDocument,
} from '@/graphql/types';

import { ResultType, StatusType } from '@/graphql/types';
import { uiText } from '@/locales/zh-CN';

import { expect, test } from '../../fixtures/test.ts';
import { expectCleanPage } from '../../helpers/errors.ts';
import { entity } from '../../mocks/cassette.ts';
import { FLOW_A, FLOW_B, flowsCassette, makeFlow } from '../../mocks/cassettes/flows.ts';

// flows-provider.tsx hardcodes these success toasts instead of routing them through
// `uiText('Flow finished successfully')` / `uiText('Flow deleted successfully')`, so the spec pins
// the literals the app actually renders.
const FLOW_FINISH_TOAST = '结束请求已受理，正在清理资源';
const FLOW_DELETE_TOAST = '删除请求已受理，清理完成后将移除任务';

const openFlowA = async (page: import('@playwright/test').Page) => {
    await page.goto('/flows');
    await page.getByRole('row', { name: /E2E Alpha/ }).click();
    await expect(page.locator('header').getByRole('button', { name: uiText('Toggle favorite') })).toBeEnabled();
};

test.describe('flow lifecycle', { tag: '@flows' }, () => {
    test.describe('rename', () => {
        const renamed: ResultOf<typeof RenameFlowDocument> = { renameFlow: ResultType.Success };

        test.use({
            cassette: flowsCassette({
                mutations: {
                    renameFlow: [
                        {
                            data: renamed,
                            setFlag: 'flow-renamed',
                            variables: { flowId: '5', title: 'E2E Alpha Renamed' },
                        },
                    ],
                },
                subscriptions: {
                    flowUpdated: [
                        {
                            frames: [
                                {
                                    payload: { data: { flowUpdated: makeFlow('5', 'E2E Alpha Renamed') } },
                                    whenFlag: 'flow-renamed',
                                },
                            ],
                        },
                    ],
                },
            }),
        });

        test('renames from the actions menu and the title persists', async ({ page, pageErrorLog }) => {
            await openFlowA(page);
            await page.getByRole('button', { name: uiText('Flow actions') }).click();
            await page.getByRole('menuitem', { name: uiText('Rename') }).click();
            await page.getByPlaceholder(uiText('Flow title')).fill('E2E Alpha Renamed');
            await page.getByPlaceholder(uiText('Flow title')).press('Enter');

            await expect(page.getByText(uiText('Flow renamed successfully'))).toBeVisible();
            await expect(page.locator('header').getByText('E2E Alpha Renamed', { exact: true })).toBeVisible();
            expectCleanPage(pageErrorLog);
        });
    });

    test.describe('finish', () => {
        const finished: ResultOf<typeof FinishFlowDocument> = { finishFlow: ResultType.Success };
        const FINISHED_FLOW_A = makeFlow('5', 'E2E Alpha', StatusType.Finished);

        test.use({
            cassette: flowsCassette({
                mutations: { finishFlow: [{ data: finished, setFlag: 'flow-finished', variables: { flowId: '5' } }] },
                // The mutation refetches FlowsDocument and the list polls every 5s, so without a
                // post-finish answer the stale Running row would overwrite the subscription delta and
                // the Finish menu item would come straight back. A flagged entry outranks the unflagged
                // one (mocks/cassette.ts), so the list only flips once the finish has been accepted.
                queries: {
                    flows: [
                        { data: { flows: [FLOW_A, FLOW_B] } },
                        { data: { flows: [FINISHED_FLOW_A, FLOW_B] }, whenFlag: 'flow-finished' },
                    ],
                },
                subscriptions: {
                    flowUpdated: [
                        {
                            frames: [
                                {
                                    payload: { data: { flowUpdated: FINISHED_FLOW_A } },
                                    whenFlag: 'flow-finished',
                                },
                            ],
                        },
                    ],
                },
            }),
        });

        test('finishes a running flow from the actions menu', async ({ page, pageErrorLog }) => {
            await openFlowA(page);
            await page.getByRole('button', { name: uiText('Flow actions') }).click();
            await page.getByRole('menuitem', { name: uiText('Finish') }).click();

            await expect(page.getByText(FLOW_FINISH_TOAST)).toBeVisible();

            await page.getByRole('button', { name: uiText('Flow actions') }).click();

            // Anchor on an item that stays: absence alone also holds while the
            // reopened menu is still rendering.
            await expect(page.getByRole('menuitem', { name: uiText('Rename') })).toBeVisible();
            await expect(page.getByRole('menuitem', { name: uiText('Finish') })).toBeHidden();
            expectCleanPage(pageErrorLog);
        });
    });

    test.describe('favorite', () => {
        const favorited: ResultOf<typeof AddFavoriteFlowDocument> = { addFavoriteFlow: ResultType.Success };

        // The star is useOptimistic and reverts once the mutation settles — the
        // persisted state only arrives via the settingsUserUpdated frame. The
        // delay keeps the optimistic flash from satisfying the persisted-state
        // asserts below before the frame lands.
        test.use({
            cassette: flowsCassette({
                mutations: {
                    addFavoriteFlow: [{ data: favorited, setFlag: 'flow-favorited', variables: { flowId: '5' } }],
                },
                subscriptions: {
                    settingsUserUpdated: [
                        {
                            frames: [
                                {
                                    delayMs: 400,
                                    payload: {
                                        data: {
                                            settingsUserUpdated: entity('UserPreferences', {
                                                favoriteFlows: ['5'],
                                                id: '1',
                                            }),
                                        },
                                    },
                                    whenFlag: 'flow-favorited',
                                },
                            ],
                        },
                    ],
                },
            }),
        });

        test('toggles the favorite star and the state persists', async ({ page, pageErrorLog }) => {
            await openFlowA(page);

            const star = page.locator('header').getByRole('button', { name: uiText('Toggle favorite') });

            await expect(star).toHaveAttribute('aria-pressed', 'false');
            await star.click();
            await expect(star).toHaveAttribute('aria-pressed', 'true');
            await expect(page.getByText(uiText('Favorite Flows'))).toBeVisible();
            await expect(star).toHaveAttribute('aria-pressed', 'true');
            expectCleanPage(pageErrorLog);
        });
    });

    test.describe('delete', () => {
        const deleted: ResultOf<typeof DeleteFlowDocument> = { deleteFlow: ResultType.Success };

        test.use({
            cassette: flowsCassette({
                mutations: { deleteFlow: [{ data: deleted, setFlag: 'flow-deleted', variables: { flowId: '5' } }] },
                // Same as `finish`: the list is refetched and polled, so the fake server has to answer
                // without the deleted row once the delete has been accepted, or the poll puts it back.
                queries: {
                    flows: [
                        { data: { flows: [FLOW_A, FLOW_B] } },
                        { data: { flows: [FLOW_B] }, whenFlag: 'flow-deleted' },
                    ],
                },
                subscriptions: {
                    flowDeleted: [
                        {
                            frames: [{ payload: { data: { flowDeleted: FLOW_A } }, whenFlag: 'flow-deleted' }],
                        },
                    ],
                },
            }),
        });

        test('deletes via the destructive confirm and drops off the list', async ({ page, pageErrorLog }) => {
            await openFlowA(page);
            await page.getByRole('button', { name: uiText('Flow actions') }).click();
            await page.getByRole('menuitem', { name: uiText('Delete') }).click();

            const dialog = page.getByRole('dialog');

            // The ConfirmationDialog title is `${confirmText}${itemType}` (confirmation-dialog.tsx),
            // i.e. `删除` + `任务流程`, not a `Delete {name}` template.
            await expect(dialog.getByRole('heading', { name: `${uiText('Delete')}${uiText('flow')}` })).toBeVisible();
            // Anchored on the variant's own fill: every shadcn Button carries
            // `border-destructive`/`ring-destructive` in its base for the invalid
            // state, so a bare /destructive/ matches whatever variant is set.
            await expect(dialog.getByRole('button', { name: uiText('Delete') })).toHaveClass(/(^|\s)bg-destructive(\s|$)/);
            await dialog.getByRole('button', { name: uiText('Delete') }).click();

            await expect(page.getByText(FLOW_DELETE_TOAST)).toBeVisible();
            await expect(page).toHaveURL(/\/flows$/);
            await expect(page.getByRole('row', { name: /E2E Beta/ })).toBeVisible();
            await expect(page.getByRole('row', { name: /E2E Alpha/ })).toBeHidden();
            expectCleanPage(pageErrorLog);
        });
    });
});
