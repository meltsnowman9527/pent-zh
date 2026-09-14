import { describe, expect, it } from 'vitest';

import {
    hasLocalizedApiErrorText,
    isNotFoundError,
    knownApiErrorMessages,
    localizeApiErrorText,
    localizeUiErrorText,
} from './errors';

describe('isNotFoundError', () => {
    it.each(['no rows in result set', 'flow not found', 'template not found: sql: no rows', 'Record Not Found'])(
        'treats %j as not-found',
        (message) => {
            expect(isNotFoundError(new Error(message))).toBe(true);
        },
    );

    // The authz strings are real backend messages that also contain "not found" (see errors.ts) —
    // they must stay classified as real failures, so do not drop them as odd-looking fixtures.
    it.each([
        'network error',
        'Failed to fetch',
        'connection refused',
        'internal server error',
        "requested permission 'flows.read' not found",
        'not authorized to access this token',
        'no permissions granted',
        'privileges are not set',
    ])('treats %j as a real failure', (message) => {
        expect(isNotFoundError(new Error(message))).toBe(false);
    });
});

describe('localizeApiErrorText', () => {
    // 契约：登记过的后端错误码必须映射成中文；登记表本身是唯一的真值来源。
    it.each(Object.keys(knownApiErrorMessages))('maps the registered backend code %j to Chinese', (code) => {
        const localized = localizeApiErrorText(code);

        expect(localized).not.toBe(code);
        expect(localized).toMatch(/[\u4e00-\u9fa5]/);
    });

    it.each([
        ['auth required', '需要登录'],
        ["requested permission 'flows.read' not found", '权限'],
        ['Internal Server Error', '服务内部错误'],
        ['timeout of 30000ms exceeded', '超时'],
        ['Network Error', '网络'],
        ['no rows in result set', '未找到'],
        ['Too Many Requests', '频繁'],
    ])('maps the backend message %j to a Chinese explanation containing %j', (message, fragment) => {
        const localized = localizeApiErrorText(message);

        expect(localized).toContain(fragment);
        expect(hasLocalizedApiErrorText(message)).toBe(true);
    });

    // 已经是中文的界面文案不能被再包一层，否则 ErrorState 会把它当成原始诊断折叠起来。
    it('leaves an unmapped message untouched and reports it as not localized', () => {
        const raw = 'flow 42 exploded while streaming';

        expect(localizeApiErrorText(raw)).toBe(raw);
        expect(hasLocalizedApiErrorText(raw)).toBe(false);
    });

    it('renders empty input as an empty string', () => {
        expect(localizeApiErrorText(null)).toBe('');
        expect(localizeApiErrorText(undefined)).toBe('');
        expect(localizeApiErrorText('   ')).toBe('');
        expect(hasLocalizedApiErrorText(null)).toBe(false);
    });
});
describe('UI error fallback', () => {
    it('translates known failures and contains unknown diagnostics', () => {
        expect(localizeUiErrorText('network error')).toContain('网络');
        expect(localizeUiErrorText('unknown provider detail')).toBe('操作未完成，请稍后重试');
        expect(localizeApiErrorText('unknown provider detail')).toBe('unknown provider detail');
        expect(localizeUiErrorText('保存失败，请检查输入')).toBe('保存失败，请检查输入');
    });
});
