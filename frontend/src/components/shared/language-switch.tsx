import { Languages } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getUILanguage, reloadUI, setUILanguage } from '@/locales/language';

export function LanguageSwitch() {
    const language = getUILanguage();
    const label = language === 'zh-CN' ? 'English' : '中文';

    return (
        <Button
            aria-label={language === 'zh-CN' ? 'Switch to English' : '切换到中文'}
            className="shrink-0"
            onClick={() => {
                setUILanguage(language === 'zh-CN' ? 'en' : 'zh-CN');
                reloadUI();
            }}
            size="sm"
            type="button"
            variant="ghost"
        >
            <Languages className="size-4" />
            {label}
        </Button>
    );
}
