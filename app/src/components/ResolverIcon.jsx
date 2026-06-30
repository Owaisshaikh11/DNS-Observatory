import { memo } from 'react';

function ResolverIcon({ ip, className = "w-3.5 h-3.5" }) {
  const cleanIp = (ip || '').toString().trim();

  if (cleanIp === '1.1.1.1' || cleanIp === '1.0.0.1' || cleanIp.includes('cloudflare')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="#F38020" title="Cloudflare Resolver">
        <path d="M22.9 14.8c-.2-1.7-1.4-3.1-3.1-3.5.1-.4.1-.7.1-1.1 0-3-2.5-5.5-5.5-5.5-2.2 0-4.1 1.3-4.9 3.2C8.7 7.4 7.6 7 6.4 7 3.4 7 1 9.4 1 12.4c0 .4 0 .8.1 1.2C.4 14 0 14.9 0 15.8 0 17.6 1.4 19 3.2 19h18c1.5 0 2.8-1.2 2.8-2.7 0-.7-.3-1.2-.8-1.5z" />
      </svg>
    );
  }

  if (cleanIp === '8.8.8.8' || cleanIp === '8.8.4.4' || cleanIp.includes('google')) {
    return (
      <svg viewBox="0 0 24 24" className={className} title="Google Resolver">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" title="Recursive Resolver">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" strokeLinecap="round" />
      <line x1="6" y1="18" x2="6.01" y2="18" strokeLinecap="round" />
      <line x1="20" y1="6" x2="16" y2="6" strokeLinecap="round" />
      <line x1="20" y1="18" x2="16" y2="18" strokeLinecap="round" />
    </svg>
  );
}

export default memo(ResolverIcon);
