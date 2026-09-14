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
    it('routes column labels, entity names and filter placeholders through uiText', () => {
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
    });
});
