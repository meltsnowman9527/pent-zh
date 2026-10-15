import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getUILanguage, initializeUILanguage, languageStorageKey, reloadUI } from '@/locales/language';
import { uiText } from '@/locales/zh-CN';

import { LanguageSwitch } from './language-switch';

vi.mock('@/locales/language', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/locales/language')>()),
    reloadUI: vi.fn(),
}));

beforeEach(() => {
    localStorage.removeItem(languageStorageKey);
    document.documentElement.lang = 'zh-CN';
    vi.clearAllMocks();
});

describe('interface language', () => {
    it('defaults to Chinese and initializes the document language from the saved preference', () => {
        expect(getUILanguage()).toBe('zh-CN');
        localStorage.setItem(languageStorageKey, 'en');
        initializeUILanguage();
        expect(document.documentElement.lang).toBe('en');
        expect(uiText('Settings')).toBe('Settings');
    });

    it('switches in both directions, persists the choice and reloads the interface', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<LanguageSwitch />);
        await user.click(screen.getByRole('button', { name: 'Switch to English' }));
        expect(localStorage.getItem(languageStorageKey)).toBe('en');
        expect(document.documentElement.lang).toBe('en');
        expect(reloadUI).toHaveBeenCalledOnce();
        rerender(<LanguageSwitch />);
        await user.click(screen.getByRole('button', { name: '切换到中文' }));
        expect(localStorage.getItem(languageStorageKey)).toBe('zh-CN');
        expect(uiText('Settings')).toBe('设置');
    });

    it('preserves values in translated templates and safely falls back for unknown copy', () => {
        expect(uiText('Flow #{id}', { id: 42 })).toBe('任务流程 #42');
        expect(uiText('Upstream added this label')).toBe('Upstream added this label');
        localStorage.setItem(languageStorageKey, 'en');
        expect(uiText('Flow #{id}', { id: 42 })).toBe('Flow #42');
    });
});
