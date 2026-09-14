import { describe, expect, it } from 'vitest';

import { flowRowNumber } from './flow-row-number';

describe('flowRowNumber', () => {
    it('numbers the first page from 1', () => {
        expect(flowRowNumber(0, 10, 0)).toBe(1);
        expect(flowRowNumber(0, 10, 9)).toBe(10);
    });

    it('continues across pages instead of restarting at 1', () => {
        expect(flowRowNumber(1, 10, 0)).toBe(11);
        expect(flowRowNumber(2, 20, 5)).toBe(46);
    });

    it('never emits a number below 1 for a negative page index', () => {
        expect(flowRowNumber(-1, 10, 0)).toBe(1);
    });
});
