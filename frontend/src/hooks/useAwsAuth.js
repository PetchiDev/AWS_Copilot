import { useState, useEffect, useCallback } from 'react';
import { checkAuth, configureAuth, clearAuth } from '../services/api';

export function useAwsAuth() {
    const [isConfigured, setIsConfigured] = useState(false);
    const [region, setRegion] = useState('ap-south-1');
    const [account, setAccount] = useState(null);
    const [arn, setArn] = useState(null);
    const [loginMethod, setLoginMethod] = useState(null); // 'sso' | 'access-key'
    const [loading, setLoading] = useState(true);
    const [showLoginModal, setShowLoginModal] = useState(false);

    const check = useCallback(async () => {
        setLoading(true);
        try {
            const data = await checkAuth();
            if (data.configured) {
                setIsConfigured(true);
                setRegion(data.region || 'ap-south-1');
                setShowLoginModal(false);
            } else {
                setIsConfigured(false);
                setShowLoginModal(true);
            }
        } catch {
            setIsConfigured(false);
            setShowLoginModal(true);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * configure() — handles BOTH login methods:
     *  - SSO:        data has { method:'sso', status:'success', configured:true }
     *                Backend already set credentials via /api/auth/sso/poll
     *  - Access Key: data has { accessKeyId, secretAccessKey, ... }
     *                Call /api/auth/configure to validate + store
     */
    const configure = useCallback(async (data) => {
        // ── SSO path: credentials already set in backend ──────────
        if (data?.method === 'sso' || data?.status === 'success') {
            setIsConfigured(true);
            setRegion(data.region || 'ap-south-1');
            setAccount(data.account || data.loginAccount?.accountId || null);
            setArn(data.arn || null);
            setLoginMethod('sso');
            setShowLoginModal(false);
            return data;
        }

        // ── Access Key path: call backend to validate & store ──────
        const result = await configureAuth(data);
        setIsConfigured(true);
        setRegion(result.region || data.region || 'ap-south-1');
        setAccount(result.account);
        setArn(result.arn);
        setLoginMethod('access-key');
        setShowLoginModal(false);
        return result;
    }, []);

    const logout = useCallback(async () => {
        await clearAuth();
        setIsConfigured(false);
        setAccount(null);
        setArn(null);
        setLoginMethod(null);
        setShowLoginModal(true);
    }, []);

    useEffect(() => { check(); }, [check]);

    return {
        isConfigured, region, account, arn, loginMethod, loading,
        showLoginModal, setShowLoginModal,
        configure, logout, check, setRegion
    };
}
