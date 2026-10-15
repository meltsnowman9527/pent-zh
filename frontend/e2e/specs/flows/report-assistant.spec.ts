import { uiText } from '@/locales/zh-CN';

import { expect, test } from '../../fixtures/test.ts';
import { expectCleanPage } from '../../helpers/errors.ts';
import { ASSISTANT_ANSWER } from '../../mocks/cassettes/assistants.ts';
import { assistantFlowReportCassette } from '../../mocks/cassettes/flows-assistant-report.ts';

const REPORT_FILE = /^report_flow_5_e2e_alpha_2026\d{10}\.md$/;

/**
 * Assistant-mode flows have no tasks and no `report` msglog, so the report menu used
 * to be hidden entirely; the transcript itself is the report.
 */
test.describe('assistant-mode flow report', { tag: '@flows' }, () => {
    test.use({ cassette: assistantFlowReportCassette() });

    test('offers the report menu when the flow has an assistant transcript instead of tasks', async ({
        page,
        pageErrorLog,
    }) => {
        await page.goto('/flows/5');

        // Without the transcript gate this button never renders: the seeded flow has no tasks.
        await page.getByRole('button', { name: uiText('Report') }).click();

        await expect(page.getByRole('menuitem', { name: uiText('Open web view') })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: uiText('Download MD') })).toBeVisible();
        expectCleanPage(pageErrorLog);
    });

    test('the standalone route renders the transcript', async ({ page, pageErrorLog }) => {
        await page.goto('/flows/5/report?assistantId=11');

        await expect(page.getByRole('heading', { name: /E2E Alpha/ })).toBeVisible();
        await expect(page.getByText(uiText('Messages'))).toBeVisible();
        await expect(page.getByText('what did the scan find?')).toBeVisible();
        await expect(page.getByText(ASSISTANT_ANSWER)).toBeVisible();

        expectCleanPage(pageErrorLog);
    });

    test('"Download MD" writes the transcript, not an empty task report', async ({ page, pageErrorLog }) => {
        await page.goto('/flows/5');
        await page.getByRole('button', { name: uiText('Report') }).click();

        const download = page.waitForEvent('download');

        await page.getByRole('menuitem', { name: uiText('Download MD') }).click();

        const file = await download;

        expect(file.suggestedFilename()).toMatch(REPORT_FILE);

        const stream = await file.createReadStream();
        const body = (await stream.toArray()).join('');

        expect(body).toContain('what did the scan find?');
        expect(body).toContain(ASSISTANT_ANSWER);
        expect(body).not.toContain(uiText('No tasks available for this flow.'));
        expectCleanPage(pageErrorLog);
    });

    test('the print route carries the assistant id so the transcript is exported', async ({ page, pageErrorLog }) => {
        await page.goto('/flows/5');
        await page.getByRole('button', { name: uiText('Report') }).click();

        const popup = page.waitForEvent('popup');

        await page.getByRole('menuitem', { name: uiText('Download PDF') }).click();

        const opened = await popup;
        const url = new URL(opened.url());

        expect(url.pathname).toBe('/flows/5/report');
        expect(url.searchParams.get('download')).toBe('true');
        expect(url.searchParams.get('assistantId')).toBe('11');
        await opened.close();
        expectCleanPage(pageErrorLog);
    });
});
