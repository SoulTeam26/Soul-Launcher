const path = require('path');
let msmc = require('msmc');

if (msmc.default) msmc = msmc.default;

// ============================================================
// MICROSOFT LOGIN
// ============================================================

async function microsoftLogin() {

    try {

        console.log(
            '[AUTH] Starting Microsoft login'
        );

        const authManager =
            new msmc.Auth("select_account");

        const iconPath = path.join(
            __dirname,
            '..',
            'assets',
            'icons',
            'icon.png'
        );

        const xboxManager =
            await authManager.launch(
                "electron",
                {
                    icon: iconPath,
                    frame: true,
                    title: 'Soul Launcher'
                }
            );

        // IMPORTANT: getMinecraft() resolves to a Minecraft *class instance*,
        // not a plain object — the token lives on `mcToken`, there is no
        // `access_token` / `error` field. (Reading those yields undefined,
        // which used to persist accounts with an empty token.)
        const mcProfile =
            await xboxManager.getMinecraft();

        if (!mcProfile || !mcProfile.profile) {

            throw new Error(
                'Minecraft auth failed'
            );
        }

        console.log(
            `[AUTH] Logged in as ${mcProfile.profile.name}`
        );

        return {

            id: mcProfile.profile.id,

            name: mcProfile.profile.name,

            type: 'microsoft',

            skin:
                `https://minotar.net/helm/${mcProfile.profile.name}/64.png`,

            token: mcProfile.mcToken,

            // IMPORTANT
            mclc: mcProfile.mclc(),

            msmcSave: xboxManager.save()
        };

    } catch (err) {

        console.error(
            '[AUTH ERROR]',
            err
        );

        throw err;
    }
}

// ============================================================
// REFRESH TOKEN
// ============================================================

async function refreshMicrosoftToken(msmcSave) {

    console.log(
        '[AUTH] Refreshing token'
    );

    const authManager =
        new msmc.Auth("select_account");

    const xboxManager =
        await authManager.refresh(msmcSave);

    const mcProfile =
        await xboxManager.getMinecraft();

    if (!mcProfile || !mcProfile.profile) {

        throw new Error(
            'Refresh failed'
        );
    }

    console.log(
        `[AUTH] Refreshed for ${mcProfile.profile.name}`
    );

    return {

        token: mcProfile.mcToken,

        // IMPORTANT
        mclc: mcProfile.mclc(),

        msmcSave: xboxManager.save()
    };
}

module.exports = {
    microsoftLogin,
    refreshMicrosoftToken
};