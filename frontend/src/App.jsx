import React, { useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import Header from './components/Header';
import ServiceSidebar from './components/ServiceSidebar';
import ChatWindow from './components/ChatWindow';
import AwsLoginModal from './components/AwsLoginModal';
import { useAwsAuth } from './hooks/useAwsAuth';
import { useChat } from './hooks/useChat';
import './index.css';

export default function App() {
  const {
    isConfigured, region, account, arn, loading: authLoading,
    showLoginModal, setShowLoginModal,
    configure, logout, check, setRegion
  } = useAwsAuth();

  const { messages, loading: chatLoading, sendMessage, clearMessages, setCurrentRegion } = useChat();

  const [prefilledPrompt, setPrefilledPrompt] = useState('');

  const handleConfigure = async (data) => {
    try {
      // data can be either SSO result { method:'sso', region, status:'success' }
      // or AK creds { accessKeyId, secretAccessKey, region }
      const result = await configure(data);
      // Guard: don't toast on pending or intermediate states
      if (result?.status === 'pending') return;
      const resolvedRegion = result?.region || data?.region || 'ap-south-1';
      toast.success(' AWS connected successfully!');
      setCurrentRegion(resolvedRegion);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to connect';
      toast.error(msg);
    }
  };

  const handleLogout = async () => {
    await logout();
    toast('👋 Logged out from AWS', { icon: '🔓' });
  };

  const handleSend = async (prompt) => {
    if (!isConfigured) {
      setShowLoginModal(true);
      return;
    }
    await sendMessage(prompt);
  };

  const handleSidebarPrompt = (prompt) => {
    setPrefilledPrompt(prompt);
  };

  const handleRegionChange = (r) => {
    setRegion(r);
    setCurrentRegion(r);
  };

  if (authLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
        <p>Checking AWS connection...</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0f1628',
            color: '#f0f4ff',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: '13px',
            borderRadius: '10px'
          }
        }}
      />

      <Header
        isConfigured={isConfigured}
        region={region}
        setRegion={handleRegionChange}
        account={account}
        arn={arn}
        onLogout={handleLogout}
        onCheckAuth={check}
      />

      <div className="app-body">
        {isConfigured && (
          <ServiceSidebar onPromptSelect={handleSidebarPrompt} />
        )}

        <ChatWindow
          messages={messages}
          loading={chatLoading}
          onSend={handleSend}
          onClear={clearMessages}
          onAuthRequired={() => setShowLoginModal(true)}
          prefilledPrompt={prefilledPrompt}
          setPrefilledPrompt={setPrefilledPrompt}
        />
      </div>

      <AwsLoginModal
        isOpen={showLoginModal}
        onConfigure={handleConfigure}
      />
    </div>
  );
}
