/**
 * A backend "no rows in result set" / "not found" GraphQL error, as opposed to a real load
 * failure (network, 5xx, cold-cache backend error). Detail pages redirect to the list on the
 * former and render an in-page ErrorState + Retry on the latter — collapsing the two silently
 * bounces the user off a page that a retry would have loaded.
 */
export const isNotFoundError = (error: { message: string }) => {
    // The backend's authz failure "requested permission '<perm>' not found" (graph/context.go) also
    // contains "not found"; classing it as a missing record would silently redirect a user who only
    // lacks access, instead of surfacing the denial.
    if (/\b(permission|privilege|unauthori[sz]ed|not authori[sz]ed|forbidden|access denied)\b/i.test(error.message)) {
        return false;
    }

    return /no rows in result set|not found/i.test(error.message);
};

/**
 * 后端错误码 / 错误消息 → 中文说明。
 *
 * 后端返回的错误文本是稳定的机器标识（GraphQL 错误码、REST `code`、Go 错误串），界面不应
 * 直接把它显示给中文用户。这里只做**展示层**映射：键仍是后端的原值，原始文本通过
 * `ErrorState` 的「原始诊断」折叠区保留，便于排查。新增后端错误码时在此登记。
 */
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
    AdminRequired: '当前账号权限不足，需要管理员权限',
    AuthRequired: '需要登录后继续',
    NotPermitted: '没有访问该资源的权限',
    PrivilegesRequired: '当前账号权限不足，需要更高权限',
    SuperRequired: '当前账号权限不足，需要超级管理员权限',
    'Users.ChangeEmailCurrentUser.EmailAlreadyExists': '该邮箱已被其他账号使用',
    'Users.ChangeEmailCurrentUser.InvalidCurrentPassword': '当前密码不正确',
    'Users.ChangeEmailCurrentUser.InvalidEmail': '邮箱格式不正确',
    'Users.ChangeNameCurrentUser.InvalidName': '姓名不符合要求',
    'Users.ChangePasswordCurrentUser.InvalidCurrentPassword': '当前密码不正确',
    'Users.ChangePasswordCurrentUser.InvalidNewPassword': '新密码不符合要求',
    'Users.ChangePasswordCurrentUser.InvalidPassword': '密码不符合要求',
    'Users.NotFound': '未找到该用户',
};

/** 后端错误文本里不返回错误码时的模式匹配（Go 错误串、HTTP 状态文本、浏览器网络错误）。 */
const ERROR_MESSAGE_PATTERNS: readonly (readonly [RegExp, string])[] = [
    [/auth required|authentication required|\bunauthoriz|\bunauthoris/i, '需要登录后继续'],
    [/permission|privilege|forbidden|access denied|not permitted/i, '没有访问该资源的权限'],
    [/no rows in result set|record not found|not found/i, '未找到对应的记录'],
    [/context canceled|context cancelled/i, '请求已取消'],
    [/deadline exceeded|timeout|timed out|ETIMEDOUT/i, '请求超时，请稍后重试'],
    [/network error|failed to fetch|networkerror|ECONNREFUSED|ENOTFOUND/i, '网络不可用，请检查与服务的连接'],
    [/too many requests/i, '请求过于频繁，请稍后重试'],
    [/internal server error|status code 500/i, '服务内部错误'],
    [/bad gateway|status code 502/i, '网关错误'],
    [/service unavailable|status code 503/i, '服务暂不可用'],
    [/gateway timeout|status code 504/i, '网关超时'],
];

/**
 * 把后端错误文本映射成中文说明。已知错误码、已知模式命中时返回中文；其余原样返回，
 * 由调用方决定是展示原文还是放进折叠的原始诊断。
 */
export const localizeApiErrorText = (text: null | string | undefined): string => {
    if (!text) {
        return '';
    }

    const trimmed = text.trim();

    if (!trimmed) {
        return '';
    }

    const known = KNOWN_ERROR_MESSAGES[trimmed];

    if (known) {
        return known;
    }

    for (const [pattern, localized] of ERROR_MESSAGE_PATTERNS) {
        if (pattern.test(trimmed)) {
            return localized;
        }
    }

    return text;
};

/** 是否把该文本替换成了中文说明（用于决定要不要保留原始诊断）。 */
export const hasLocalizedApiErrorText = (text: null | string | undefined): boolean =>
    Boolean(text) && localizeApiErrorText(text) !== text;

/** 供测试与调用方读取的已知错误码表（键为后端原值）。 */
export const knownApiErrorMessages = KNOWN_ERROR_MESSAGES;

/** UI fallback for unmapped diagnostics; callers retain the raw error in logs/details. */
export const localizeUiErrorText = (text: null | string | undefined): string => {
    const localized = localizeApiErrorText(text);

    return localized && /[\u3400-\u9fff]/u.test(localized) ? localized : '操作未完成，请稍后重试';
};
