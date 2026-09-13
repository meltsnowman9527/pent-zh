import { uiText } from '@/locales/zh-CN';

function PageLoader() {
    return (
        <div className="grid h-screen w-full place-items-center">
            <p>{uiText('Loading...')}</p>
        </div>
    );
}

export default PageLoader;
