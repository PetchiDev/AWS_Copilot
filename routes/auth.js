const express = require('express');
const router = express.Router();
const { isConfigured, setCredentials, clearCredentials, getRegion } = require('../services/awsClient');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const ssoService = require('../services/ssoService');

// ─── GET /api/auth/check ───────────────────────────────────────────
router.get('/check', async (req, res, next) => {
    try {
        const configured = isConfigured();
        if (!configured) {
            return res.status(401).json({
                success: false,
                configured: false,
                message: 'AWS credentials not configured'
            });
        }
        res.json({
            success: true,
            configured: true,
            region: getRegion(),
            message: 'AWS credentials are configured'
        });
    } catch (err) {
        next(err);
    }
});

// ─── POST /api/auth/configure (Manual AK/SK) ──────────────────────
router.post('/configure', async (req, res, next) => {
    try {
        const { accessKeyId, secretAccessKey, region, sessionToken } = req.body;
        if (!accessKeyId || !secretAccessKey) {
            return res.status(400).json({ success: false, error: 'accessKeyId and secretAccessKey are required' });
        }
        if (!/^[A-Z0-9]{20}$/.test(accessKeyId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid AWS Access Key ID format (must be 20 uppercase alphanumeric characters)'
            });
        }

        setCredentials({ accessKeyId, secretAccessKey, region: region || 'ap-south-1', sessionToken });

        // Verify via STS GetCallerIdentity
        const stsClient = new STSClient({
            region: region || 'ap-south-1',
            credentials: { accessKeyId, secretAccessKey, ...(sessionToken && { sessionToken }) }
        });
        const identity = await stsClient.send(new GetCallerIdentityCommand({}));

        res.json({
            success: true,
            configured: true,
            method: 'access-key',
            region: region || 'ap-south-1',
            account: identity.Account,
            userId: identity.UserId,
            arn: identity.Arn,
            message: ' AWS credentials configured and verified successfully'
        });
    } catch (err) {
        clearCredentials();
        if (['InvalidClientTokenId', 'AuthFailure', 'InvalidSignatureException'].includes(err.name)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid AWS credentials. Please check your Access Key ID and Secret Access Key.',
                code: err.name
            });
        }
        next(err);
    }
});

// ─── DELETE /api/auth/clear ───────────────────────────────────────
router.delete('/clear', (req, res) => {
    clearCredentials();
    ssoService.clearState();
    res.json({ success: true, message: 'AWS credentials cleared' });
});

// ══════════════════════════════════════════════════════════════════
// AWS SSO (IAM Identity Center) — Device Authorization Flow
// ══════════════════════════════════════════════════════════════════

/**
 * POST /api/auth/sso/start
 * Body: { startUrl, region }
 * Returns: { verificationUri, userCode, expiresIn, interval }
 *
 * The user opens `verificationUri` in their browser and enters `userCode`.
 * Then the frontend polls /api/auth/sso/poll until credentials arrive.
 */
router.post('/sso/start', async (req, res, next) => {
    try {
        const { startUrl, region } = req.body;

        if (!startUrl) {
            return res.status(400).json({
                success: false,
                error: 'startUrl is required. Example: https://my-company.awsapps.com/start'
            });
        }
        if (!region) {
            return res.status(400).json({
                success: false,
                error: 'region is required. Example: ap-south-1'
            });
        }

        const result = await ssoService.startSSOLogin({ startUrl, region });

        res.json({
            success: true,
            ...result,
            message: 'Open the verification URL in your browser and enter the code to authorize.'
        });
    } catch (err) {
        console.error('SSO Start Error:', err.message);
        next(err);
    }
});

/**
 * POST /api/auth/sso/poll
 * Frontend calls this after user approves in browser.
 * Returns: { status: 'pending' } until approved, then full credentials.
 */
router.post('/sso/poll', async (req, res, next) => {
    try {
        const result = await ssoService.pollForToken();

        if (result.status === 'pending') {
            return res.json({ success: true, ...result });
        }

        // Got credentials — set them in the app
        const { credentials, account, region } = result;
        setCredentials({
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
            region: region || 'ap-south-1'
        });

        // Verify with STS
        let identity = {};
        try {
            const stsClient = new STSClient({
                region: region || 'ap-south-1',
                credentials: {
                    accessKeyId: credentials.accessKeyId,
                    secretAccessKey: credentials.secretAccessKey,
                    sessionToken: credentials.sessionToken
                }
            });
            const id = await stsClient.send(new GetCallerIdentityCommand({}));
            identity = { account: id.Account, userId: id.UserId, arn: id.Arn };
        } catch (_) { /* STS check is optional */ }

        res.json({
            success: true,
            status: 'success',
            configured: true,
            method: 'sso',
            region,
            loginAccount: account,
            ...identity,
            credentialExpiry: credentials.expiration,
            message: result.message
        });
    } catch (err) {
        console.error('SSO Poll Error:', err.name, err.message);
        // All "grant" errors → return 400 so frontend can recover cleanly
        const recoverableErrors = [
            'expired', 'No SSO session', 'already used',
            'Access denied', 'dismissed', 'InvalidGrantException',
            'AccessDeniedException', 'ExpiredTokenException'
        ];
        const isRecoverable = recoverableErrors.some(e => err.message?.includes(e) || err.name?.includes(e));
        if (isRecoverable) {
            return res.status(400).json({
                success: false,
                error: err.message || 'SSO session expired. Please start over.',
                code: err.name || 'SSOSessionExpired'
            });
        }
        next(err);
    }
});

/**
 * GET /api/auth/sso/status
 * Returns whether an SSO polling session is active.
 */
router.get('/sso/status', (req, res) => {
    const state = ssoService.getState();
    res.json({
        success: true,
        hasActiveSSOSession: !!state,
        expiresAt: state?.expiresAt ? new Date(state.expiresAt).toISOString() : null
    });
});

module.exports = router;
