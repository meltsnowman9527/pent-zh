import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the table UI against hardcoded English that the JSX-text scanners miss.
 *
 * Three props carry user-visible text but take a plain string, so nothing forces
 * them through the copy table and a raw literal renders English straight into a
 * Chinese interface:
 *   - `columnMenuLabel` labels the "columns" and "search in" dropdowns
 *   - `entityName` is interpolated into empty-state sentences
 *   - `filterPlaceholder` is the search box placeholder
 *   - `sheetTitle` is rendered as the detail-navigation sheet heading
 *   - `primaryLabel` is the submit button of the resources copy/move dialogs
 *
 * `columnMenuLabel` also has a silent failure mode: omit it and the menu falls
 * back to the raw column id ("updatedAt", "provider").
 */
const SRC = join(__dirname, '..', 'src');
const SKIP_DIRS = new Set(['graphql', 'locales']);
const RULES: { hint: string; pattern: RegExp }[] = [
    { hint: 'wrap it in uiText(...)', pattern: /columnMenuLabel:\s*'(?!')/ },
    { hint: 'wrap it in uiText(...)', pattern: /entityName:\s*'(?!')/ },
    { hint: 'wrap it in uiText(...)', pattern: /filterPlaceholder="/ },
    { hint: 'wrap it in uiText(...)', pattern: /primaryLabel="/ },
    { hint: 'wrap it in uiText(...)', pattern: /sheetTitle="/ },
];

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name.startsWith('.')) {
            return [];
        }

        const full = join(dir, entry.name);

        if (entry.isDirectory()) {
            return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(full);
        }

        if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) {
            return [];
        }

        return [full];
    });

describe('table copy hygiene', () => {
    // Reading every source file is fast in isolation (~40ms) but the full suite runs
    // its files in parallel and starved this one past the 5s default; the budget is
    // only there to catch a hang, not to measure the scan.
    it('routes column labels, entity names, filter placeholders and sheet titles through uiText', () => {
        const violations: string[] = [];

        for (const file of sourceFiles(SRC)) {
            const lines = readFileSync(file, 'utf8').split(/\r?\n/);

            lines.forEach((line, index) => {
                for (const rule of RULES) {
                    if (rule.pattern.test(line)) {
                        violations.push(
                            `${relative(SRC, file).split(sep).join('/')}:${index + 1} — ${line.trim()} (${rule.hint})`,
                        );
                    }
                }
            });
        }

        expect(violations).toEqual([]);
    }, 30_000);
});
