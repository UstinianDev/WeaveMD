// ============================================
// WeaveMD — Window Control Buttons
// ============================================

import React, { useState, useEffect } from 'react';

const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.weaveMD.window.isMaximized().then(setIsMaximized).catch(() => {});
  }, []);

  const handleMinimize = () => window.weaveMD.window.minimize();

  const handleMaximize = async () => {
    await window.weaveMD.window.maximize();
    const maximized = await window.weaveMD.window.isMaximized();
    setIsMaximized(maximized);
  };

  const handleClose = () => window.weaveMD.window.close();

  const btnClass =
    'w-11 h-full flex items-center justify-center transition-colors';
  const btnStyle = { color: 'var(--navbar-text-sub, #999999)' };

  return (
    <div className="flex items-center h-full no-drag">
      {/* Minimize */}
      <button
        onClick={handleMinimize}
        className={btnClass}
        style={btnStyle}
        title="Minimize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={handleMaximize}
        className={btnClass}
        style={btnStyle}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="3" y="0.5" width="8" height="8" rx="0.5" stroke="currentColor" fill="none" />
            <rect x="0.5" y="3" width="8" height="8" rx="0.5" stroke="currentColor" fill="var(--navbar-bg)" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1" y="1" width="10" height="10" rx="0.5" stroke="currentColor" fill="none" />
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        onClick={handleClose}
        className={btnClass}
        style={btnStyle}
        title="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.2" />
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
};

export default WindowControls;
