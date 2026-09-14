import type { ResultOf } from '@graphql-typed-document-node/core';
import type { Page } from '@playwright/test';

import type { ResourceAddedDocument } from '@/graphql/types';

import { uiText } from '@/locales/zh-CN';

import { expect, test } from '../../fixtures/test.ts';
import { expectCleanPage } from '../../helpers/errors.ts';
import {
    COPY_DESTINATION,
    CREATED_FOLDER,
    emptyResourcesCassette,
    FILE_RESOURCE,
    FOLDER_RESOURCE,
    RENAMED_PATH,
    resourcesCassette,
    resourceWrites,
} from '../../mocks/cassettes/resources.ts';

interface DownloadClick {
    download: string;
    href: string;
}

// Both CTAs and the copy row action go through the copy table since the last hygiene pass
// (src/features/resources/resources-*-dialog.tsx, src/pages/resources/resources.tsx).
const COPY_PRIMARY_LABEL = uiText('Copy');
const MOVE_PRIMARY_LABEL = uiText('Move');

test.describe('resources', { tag: '@coverage' }, () => {
    test.describe('listing', () => {
        test.use({ cassette: resourcesCassette() });

        test('renders seeded entries with sortable column headers', async ({ page, pageErrorLog }) => {
            await page.goto('/resources');

            await expect(page.getByRole('treeitem', { name: /reports/ })).toBeVisible();
            await expect(page.getByRole('treeitem', { name: /notes\.txt/ })).toBeVisible();
            // The column heading is `Sort by {label} (ascending)`; `label` is the file manager's own
            // English column id (file-manager.tsx COLUMN_LABEL_FOR_ARIA), not a copy-table entry.
            const sortAscending = (label: string) => uiText('Sort by {label} (ascending)', { label });

            await expect(page.getByRole('button', { name: sortAscending('name') })).toBeVisible();
            await expect(page.getByRole('button', { name: sortAscending('size') })).toBeVisible();
            await expect(page.getByRole('button', { name: sortAscending('modified date') })).toBeVisible();
            expectCleanPage(pageErrorLog);
        });
    });

    test.describe('mkdir', () => {
        // Type a name distinct from the dialog's default so the request body proves the
        // typed value reached it — a value equal to the default would match even if the
        // input→payload binding were broken.
        const TYPED_PATH = 'e2e-typed-folder';
        const added: ResultOf<typeof ResourceAddedDocument> = {
            resourceAdded: { ...CREATED_FOLDER, name: TYPED_PATH, path: TYPED_PATH },
        };

        test.use({
            cassette: resourcesCassette({
                rest: {
                    'POST /api/v1/resources/mkdir': [
                        {
                            body: { data: {}, status: 'success' },
                            bodySubset: { path: TYPED_PATH },
                            setFlag: 'folder-created',
                        },
                    ],
                },
                subscriptions: {
                    resourceAdded: [{ frames: [{ payload: { data: added }, whenFlag: 'folder-created' }] }],
                },
            }),
        });

        test('creates a directory and the new row arrives via subscription', async ({ page, pageErrorLog }) => {
            await page.goto('/resources');
            await page.getByRole('button', { name: uiText('New folder') }).click();

            const dialog = page.getByRole('dialog');

            await expect(dialog.getByRole('heading', { name: uiText('Create directory') })).toBeVisible();
            await expect(dialog.getByLabel(uiText('Path'))).toHaveValue('new-folder');
            await dialog.getByLabel(uiText('Path')).fill(TYPED_PATH);
            await dialog.getByRole('button', { name: uiText('Create') }).click();

            await expect(page.getByText(uiText('Directory created'))).toBeVisible();
            await expect(page.getByRole('treeitem', { name: new RegExp(TYPED_PATH) })).toBeVisible();
            expectCleanPage(pageErrorLog);
        });
    });

    test.describe('empty state', () => {
        test.use({ cassette: emptyResourcesCassette() });

        test('shows the upload call to action', async ({ page, pageErrorLog }) => {
            await page.goto('/resources');

            await expect(page.getByText(uiText('No resources yet'))).toBeVisible();
            // Scope to the drop zone (its hint is unique) so the toolbar's Upload button is excluded.
            const dropZone = page
                .locator('div')
                .filter({ hasText: uiText('Up to 300 MB per file · 2 GB per upload') })
                .last();

            await expect(dropZone.getByRole('button', { name: uiText('Upload files') })).toBeVisible();
            expectCleanPage(pageErrorLog);
        });
    });

    // Every write here is a different verb on a path that also serves the SPA: a wrong method answers
    // 200 with HTML instead of 404, so these tests pin the method and the payload, not just the toast.
    test.describe('write verbs', () => {
        test.use({ cassette: resourcesCassette({ rest: resourceWrites() }) });

        const rowActions = (page: Page, name: string) =>
            page.getByRole('treeitem', { name: new RegExp(name) }).getByRole('button', { name: uiText('Row actions') });

        test('rename issues a PUT to /resources/move carrying the typed destination', async ({
            page,
            pageErrorLog,
        }) => {
            await page.goto('/resources');

            const request = page.waitForRequest(
                (candidate) =>
                    candidate.method() === 'PUT' && new URL(candidate.url()).pathname === '/api/v1/resources/move',
            );

            await rowActions(page, FILE_RESOURCE.name).click();
            await page.getByRole('menuitem', { name: uiText('Rename or move') }).click();

            const dialog = page.getByRole('dialog');

            await dialog.getByLabel(uiText('New path')).fill(RENAMED_PATH);
            await dialog.getByRole('button', { exact: true, name: MOVE_PRIMARY_LABEL }).click();

            expect((await request).postDataJSON()).toMatchObject({
                destination: RENAMED_PATH,
                sources: [FILE_RESOURCE.path],
            });
            expectCleanPage(pageErrorLog);
        });

        test('copy issues a POST to /resources/copy', async ({ page, pageErrorLog }) => {
            await page.goto('/resources');

            const request = page.waitForRequest(
                (candidate) =>
                    candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/v1/resources/copy',
            );

            await rowActions(page, FILE_RESOURCE.name).click();
            await page.getByRole('menuitem', { name: uiText('Copy to…') }).click();

            const dialog = page.getByRole('dialog');

            await dialog.getByLabel(uiText('Destination path')).fill(COPY_DESTINATION);
            await dialog.getByRole('button', { exact: true, name: COPY_PRIMARY_LABEL }).click();

            expect((await request).postDataJSON()).toMatchObject({
                destination: COPY_DESTINATION,
                sources: [FILE_RESOURCE.path],
            });
            expectCleanPage(pageErrorLog);
        });

        // Copying onto an existing name must stop at a confirmation instead of overwriting silently:
        // the request may not leave until the user takes the second decision.
        test('a colliding destination raises the replace guard before any request', async ({ page }) => {
            await page.goto('/resources');

            let copyRequests = 0;

            page.on('request', (candidate) => {
                if (new URL(candidate.url()).pathname === '/api/v1/resources/copy') {
                    copyRequests += 1;
                }
            });

            await rowActions(page, FILE_RESOURCE.name).click();
            await page.getByRole('menuitem', { name: uiText('Copy to…') }).click();
            await page.getByRole('dialog').getByLabel(uiText('Destination path')).fill(FOLDER_RESOURCE.name);
            await page.getByRole('dialog').getByRole('button', { exact: true, name: COPY_PRIMARY_LABEL }).click();

            await expect(page.getByRole('dialog', { name: uiText('Replace existing item?') })).toBeVisible();
            expect(copyRequests, 'nothing is sent while the guard is open').toBe(0);

            await page.getByRole('button', { name: uiText('Cancel') }).click();
            expect(copyRequests, 'cancelling the guard sends nothing at all').toBe(0);
        });

        test('delete issues a DELETE whose query carries the row path', async ({ page, pageErrorLog }) => {
            await page.goto('/resources');

            const request = page.waitForRequest(
                (candidate) =>
                    candidate.method() === 'DELETE' && new URL(candidate.url()).pathname === '/api/v1/resources/',
            );

            await rowActions(page, FILE_RESOURCE.name).click();
            await page.getByRole('menuitem', { name: uiText('Delete') }).click();
            await page.getByRole('dialog').getByRole('button', { exact: true, name: uiText('Delete') }).click();

            expect(new URL((await request).url()).searchParams.getAll('paths[]')).toEqual([FILE_RESOURCE.path]);
            expectCleanPage(pageErrorLog);
        });

        // An `<a download>` transfer is carried out by the browser outside the page, so no Playwright
        // route — page- or context-scoped — is ever offered it: one started here leaves for whatever
        // the preview proxy targets. The bytes are asserted in specs/real/resources-download.spec.ts.
        test('the row download action links at the row, saved under its name', async ({ page, pageErrorLog }) => {
            await page.goto('/resources');
            await rowActions(page, FILE_RESOURCE.name).click();

            const link = page.getByRole('menuitem', { name: uiText('Download') });

            await expect(link).toHaveAttribute('download', FILE_RESOURCE.name);

            const href = new URL((await link.getAttribute('href')) ?? '', page.url());

            expect(href.pathname).toBe('/api/v1/resources/download');
            expect(href.searchParams.getAll('paths[]')).toEqual([FILE_RESOURCE.path]);
            expectCleanPage(pageErrorLog);
        });

        // Multi-select is a different code path: one transfer carrying every selected path, saved
        // under an archive name. Neither is derivable from the single-row case.
        test('the bulk action asks for every selected path in one archive', async ({ page, pageErrorLog }) => {
            // Its anchor is created, clicked and dropped inside one handler, so nothing survives in
            // the DOM to read — record the click and swallow it instead of starting a transfer.
            await page.addInitScript(() => {
                const recorded: DownloadClick[] = [];

                (window as unknown as { e2eDownloads: DownloadClick[] }).e2eDownloads = recorded;

                const { click } = HTMLAnchorElement.prototype;

                HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
                    if (!this.hasAttribute('download')) {
                        click.call(this);

                        return;
                    }

                    recorded.push({ download: this.download, href: this.href });
                };
            });
            await page.goto('/resources');
            await page
                .getByRole('checkbox', { name: uiText('Select {name}', { name: FILE_RESOURCE.name }) })
                .click();
            await page
                .getByRole('checkbox', { name: uiText('Select {name}', { name: FOLDER_RESOURCE.name }) })
                .click();
            await page.getByRole('button', { exact: true, name: uiText('Download') }).click();

            const clicks = await page.evaluate(
                () => (window as unknown as { e2eDownloads: DownloadClick[] }).e2eDownloads,
            );

            expect(clicks, 'one transfer for the whole selection').toHaveLength(1);

            const { download, href } = clicks[0]!;

            expect(new URL(href).pathname).toBe('/api/v1/resources/download');
            expect(new URL(href).searchParams.getAll('paths[]').sort()).toEqual(
                [FILE_RESOURCE.path, FOLDER_RESOURCE.path].sort(),
            );
            expect(download).toMatch(/\.zip$/);
            expectCleanPage(pageErrorLog);
        });
    });
});
