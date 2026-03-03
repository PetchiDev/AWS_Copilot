/**
 * ssoService.js
 * AWS IAM Identity Center (SSO) - Device Authorization Flow
 *
 * Flow:
 *  1. registerClient()   → get clientId + clientSecret (valid ~90 days)
 *  2. startDeviceAuth()  → get verificationUri + userCode + deviceCode
 *  3. User opens the URL and enters the code in their browser
 *  4. pollForToken()     → polls every `interval` seconds until approved
 *  5. getCredentials()   → exchanges SSO accessToken for temp IAM credentials
 */

const {
    SSOOIDCClient,
    RegisterClientCommand,
    StartDeviceAuthorizationCommand,
    CreateTokenCommand
} = require('@aws-sdk/client-sso-oidc');

const {
    SSOClient,
    ListAccountsCommand,
    ListAccountRolesCommand,
    GetRoleCredentialsCommand
} = require('@aws-sdk/client-sso');

// ─── In-memory store (per-session) ────────────────────────────────
let _ssoState = null; // { oidcClient, ssoClient, startUrl, region, clientId, clientSecret, deviceCode, interval }

function getState() { return _ssoState; }
function clearState() { _ssoState = null; }

// ─── Step 1 + 2: Register client & Start device authorization ─────
async function startSSOLogin({ startUrl, region }) {
    if (!startUrl || !region) {
        throw new Error('startUrl and region are required');
    }

    try {
        const oidcClient = new SSOOIDCClient({ region });

        // Register this app as an OIDC client
        const reg = await oidcClient.send(new RegisterClientCommand({
            clientName: 'AWS-Copilot',
            clientType: 'public'
        }));

        // Start the device authorization
        const auth = await oidcClient.send(new StartDeviceAuthorizationCommand({
            clientId: reg.clientId,
            clientSecret: reg.clientSecret,
            startUrl
        }));

        // Store state for polling
        _ssoState = {
            oidcClient,
            startUrl,
            region,
            clientId: reg.clientId,
            clientSecret: reg.clientSecret,
            deviceCode: auth.deviceCode,
            interval: (auth.interval || 5) * 1000,
            expiresAt: Date.now() + (auth.expiresIn || 600) * 1000
        };

        return {
            verificationUri: auth.verificationUriComplete || auth.verificationUri,
            userCode: auth.userCode,
            expiresIn: auth.expiresIn || 600,
            interval: auth.interval || 5
        };
    } catch (err) {
        if (err.name === 'InvalidRequestException') {
            const error = new Error('Invalid SSO Start URL or Region. Please verify that your Start URL is correct and that SSO is enabled in the selected region.');
            error.name = 'InvalidRequestException';
            throw error;
        }
        throw err;
    }
}

// ─── Step 4: Poll for token ────────────────────────────────────────
async function pollForToken() {
    if (!_ssoState) {
        throw new Error('No SSO session in progress. Call startSSOLogin first.');
    }

    const { oidcClient, clientId, clientSecret, deviceCode, expiresAt, region } = _ssoState;

    if (Date.now() > expiresAt) {
        clearState();
        throw new Error('SSO session expired. Please start the login process again.');
    }

    try {
        const token = await oidcClient.send(new CreateTokenCommand({
            clientId,
            clientSecret,
            grantType: 'urn:ietf:params:oauth:grant-type:device_code',
            deviceCode
        }));

        // Success — store token and create SSO client
        const ssoClient = new SSOClient({ region });
        _ssoState = { ..._ssoState, ssoClient, accessToken: token.accessToken };

        // Get first available account + role credentials
        const credentials = await getFirstAvailableCredentials(ssoClient, token.accessToken, region);
        return credentials;

    } catch (err) {
        if (err.name === 'AuthorizationPendingException') {
            return { status: 'pending', message: 'Waiting for user to approve in browser...' };
        }
        if (err.name === 'SlowDownException') {
            return { status: 'pending', message: 'Slowing down polling...' };
        }
        if (err.name === 'ExpiredTokenException') {
            clearState();
            throw new Error('SSO token expired. Please start the login process again.');
        }
        if (err.name === 'InvalidGrantException') {
            clearState();
            throw new Error('The device code has expired or was already used. Please click "Start Over" and try again.');
        }
        if (err.name === 'AccessDeniedException') {
            clearState();
            throw new Error('Access denied. You may have dismissed the approval. Please click "Start Over" and try again.');
        }
        throw err;
    }
}

// ─── Step 5: Get temporary credentials from SSO ───────────────────
async function getFirstAvailableCredentials(ssoClient, accessToken, region) {
    // List accounts accessible via this SSO session
    const accountsData = await ssoClient.send(new ListAccountsCommand({
        accessToken,
        maxResults: 10
    }));

    const accounts = accountsData.accountList || [];
    if (accounts.length === 0) {
        throw new Error('No AWS accounts found in this SSO session. Check your IAM Identity Center configuration.');
    }

    // Use first account - list its roles
    const firstAccount = accounts[0];
    const rolesData = await ssoClient.send(new ListAccountRolesCommand({
        accessToken,
        accountId: firstAccount.accountId,
        maxResults: 10
    }));

    const roles = rolesData.roleList || [];
    if (roles.length === 0) {
        throw new Error(`No roles found in account ${firstAccount.accountId}. Assign a permission set in IAM Identity Center.`);
    }

    // Use first available role
    const firstRole = roles[0];
    const credsData = await ssoClient.send(new GetRoleCredentialsCommand({
        accessToken,
        accountId: firstAccount.accountId,
        roleName: firstRole.roleName
    }));

    const creds = credsData.roleCredentials;

    // Clear SSO state — credentials obtained
    clearState();

    return {
        status: 'success',
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
            expiration: creds.expiration
        },
        account: {
            accountId: firstAccount.accountId,
            accountName: firstAccount.accountName,
            roleName: firstRole.roleName
        },
        region,
        message: ` Signed in as ${firstRole.roleName} in ${firstAccount.accountName || firstAccount.accountId}`
    };
}

// ─── List all accounts and roles (for advanced selection) ─────────
async function listAccountsAndRoles(accessToken, region) {
    const ssoClient = new SSOClient({ region });
    const accountsData = await ssoClient.send(new ListAccountsCommand({ accessToken, maxResults: 20 }));
    const accounts = accountsData.accountList || [];

    const result = [];
    for (const acct of accounts) {
        const rolesData = await ssoClient.send(new ListAccountRolesCommand({
            accessToken,
            accountId: acct.accountId,
            maxResults: 20
        }));
        result.push({
            accountId: acct.accountId,
            accountName: acct.accountName,
            roles: (rolesData.roleList || []).map(r => r.roleName)
        });
    }
    return result;
}

module.exports = {
    startSSOLogin,
    pollForToken,
    clearState,
    getState,
    listAccountsAndRoles,
    getFirstAvailableCredentials
};
