export type UILanguage = 'en' | 'zh-CN';

export const languageStorageKey = 'pentagi-ui-language';

export function getUILanguage(): UILanguage {
    try {
        const stored = localStorage.getItem(languageStorageKey);
        if (stored === 'en' || stored === 'zh-CN') {
            return stored;
        }
        return document.documentElement.lang === 'en' ? 'en' : 'zh-CN';
    } catch {
        return 'zh-CN';
    }
}

export function initializeUILanguage() {
    document.documentElement.lang = getUILanguage();
}

export function setUILanguage(language: UILanguage) {
    // Persist before reloading: module-level menu labels and validation schemas
    // are rebuilt in the selected language along with the rest of the interface.
    localStorage.setItem(languageStorageKey, language);
    document.documentElement.lang = language;
}

export function reloadUI() {
    window.location.reload();
}
